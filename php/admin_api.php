<?php
declare(strict_types=1);

/**
 * Map of Us · 小程序内管理接口
 * 管理员（owner）在小程序里维护：分类（增/改/排序/显隐/删）、菜品（增改/传图/上下架/删）、订单（列表/改状态）。
 * 鉴权：用 openid 标记 app_users.is_admin；首次用后台口令认领（claim_admin）。
 * 与 menu.php / auth.php / order.php 共用 _private/db.php、_private/config.php。
 */

require_once dirname(__DIR__) . '/_private/db.php';

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

function out($data, int $code = 200): void
{
    http_response_code($code);
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function fail(string $msg, int $code = 400): void
{
    out(['error' => 'admin_error', 'message' => $msg], $code);
}

function is_admin_openid(PDO $pdo, string $openid): bool
{
    if ($openid === '') {
        return false;
    }
    $st = $pdo->prepare('SELECT is_admin FROM app_users WHERE openid = ?');
    $st->execute([$openid]);
    return (int) ($st->fetchColumn() ?: 0) === 1;
}

/** 是否为已登录用户（openid 已通过微信登录写入 app_users） */
function is_known_user(PDO $pdo, string $openid): bool
{
    if ($openid === '') {
        return false;
    }
    $st = $pdo->prepare('SELECT 1 FROM app_users WHERE openid = ?');
    $st->execute([$openid]);
    return (bool) $st->fetchColumn();
}

function gen_id(string $prefix): string
{
    return $prefix . date('YmdHis') . '_' . bin2hex(random_bytes(3));
}

function is_date(string $s): bool
{
    return (bool) preg_match('/^\d{4}-\d{2}-\d{2}$/', $s);
}

function ensure_couple_messages_table(PDO $pdo): void
{
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS couple_messages (
          id          VARCHAR(32)   NOT NULL PRIMARY KEY,
          openid      VARCHAR(64)   NOT NULL DEFAULT '',
          nickname    VARCHAR(64)   NOT NULL DEFAULT '',
          avatar_url  VARCHAR(512)  NOT NULL DEFAULT '',
          content     TEXT          NOT NULL,
          created_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          deleted_at  DATETIME      DEFAULT NULL,
          INDEX idx_visible_created (deleted_at, created_at),
          INDEX idx_openid (openid)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
    );
}

/** 经纬度规整：合法的数字字符串/数字返回 float，否则返回 null */
function norm_coord($v): ?float
{
    if ($v === '' || $v === null) {
        return null;
    }
    return is_numeric($v) ? (float) $v : null;
}

/** 把 trip_plans 行里的住宿/出发点字段解析为结构化输出（与 plans.php 保持一致） */
function plan_places_admin(array $p): array
{
    $hotel = null;
    $hname = trim((string) ($p['hotel_name'] ?? ''));
    $hlat = $p['hotel_lat'];
    $hlng = $p['hotel_lng'];
    if ($hname !== '' || $hlat !== null) {
        $hotel = [
            'name' => $hname,
            'address' => (string) ($p['hotel_address'] ?? ''),
            'lat' => $hlat === null ? null : (float) $hlat,
            'lng' => $hlng === null ? null : (float) $hlng,
        ];
    }
    $dayStarts = [];
    $raw = $p['day_starts'] ?? '';
    if (is_string($raw) && $raw !== '') {
        $decoded = json_decode($raw, true);
        if (is_array($decoded)) {
            foreach ($decoded as $day => $ds) {
                if (!is_array($ds)) {
                    continue;
                }
                $dayStarts[(string) $day] = [
                    'name' => (string) ($ds['name'] ?? ''),
                    'address' => (string) ($ds['address'] ?? ''),
                    'lat' => isset($ds['lat']) && $ds['lat'] !== '' && $ds['lat'] !== null ? (float) $ds['lat'] : null,
                    'lng' => isset($ds['lng']) && $ds['lng'] !== '' && $ds['lng'] !== null ? (float) $ds['lng'] : null,
                ];
            }
        }
    }
    $hotels = [];
    $rawH = $p['hotels'] ?? '';
    if (is_string($rawH) && $rawH !== '') {
        $decodedH = json_decode($rawH, true);
        if (is_array($decodedH)) {
            foreach ($decodedH as $h) {
                if (!is_array($h)) {
                    continue;
                }
                $name = trim((string) ($h['name'] ?? ''));
                $sd = (int) ($h['startDay'] ?? 0);
                $ed = (int) ($h['endDay'] ?? 0);
                if ($name === '' && !isset($h['lat'])) {
                    continue;
                }
                $hotels[] = [
                    'name' => $name,
                    'address' => (string) ($h['address'] ?? ''),
                    'lat' => isset($h['lat']) && $h['lat'] !== '' && $h['lat'] !== null ? (float) $h['lat'] : null,
                    'lng' => isset($h['lng']) && $h['lng'] !== '' && $h['lng'] !== null ? (float) $h['lng'] : null,
                    'startDay' => $sd > 0 ? $sd : 1,
                    'endDay' => $ed >= $sd && $ed > 0 ? $ed : ($sd > 0 ? $sd : 1),
                ];
            }
        }
    }
    return ['hotel' => $hotel, 'hotels' => $hotels, 'dayStarts' => (object) $dayStarts];
}

/** 高德 Web 服务 GET 调用，返回解码后的数组（失败返回 null） */
function amap_get(string $endpoint, array $params, string $key): ?array
{
    $params['key'] = $key;
    $url = 'https://restapi.amap.com/v3/' . ltrim($endpoint, '/') . '?' . http_build_query($params);
    $ctx = stream_context_create(['http' => ['timeout' => 8, 'ignore_errors' => true]]);
    $raw = @file_get_contents($url, false, $ctx);
    if ($raw === false) {
        return null;
    }
    $data = json_decode($raw, true);
    return is_array($data) ? $data : null;
}

/** 高德地点解析：优先 POI，失败再地理编码；返回 null 时调用方自行降级 */
function amap_lookup_place(string $key, string $address, string $city = ''): ?array
{
    $address = trim($address);
    $city = trim($city);
    if ($key === '' || $address === '') {
        return null;
    }

    $poi = amap_get('place/text', [
        'keywords' => $address,
        'city' => $city,
        'offset' => 1,
        'page' => 1,
        'extensions' => 'all',
    ], $key);
    if ($poi && ($poi['status'] ?? '0') === '1' && !empty($poi['pois'][0]['location'])) {
        $p = $poi['pois'][0];
        [$lng, $lat] = array_map('floatval', explode(',', (string) $p['location']));
        if ($lng !== 0.0 || $lat !== 0.0) {
            $addrParts = [];
            foreach (['pname', 'cityname', 'adname', 'address'] as $k) {
                $v = $p[$k] ?? '';
                if (is_string($v) && $v !== '' && !in_array($v, $addrParts, true)) {
                    $addrParts[] = $v;
                }
            }
            $biz = is_array($p['biz_ext'] ?? null) ? $p['biz_ext'] : [];
            $openHours = '';
            foreach (['open_time', 'opentime', 'open_time2'] as $k) {
                if (is_string($biz[$k] ?? null) && trim((string) $biz[$k]) !== '') {
                    $openHours = trim((string) $biz[$k]);
                    break;
                }
            }
            $ticket = '';
            foreach (['cost', 'price'] as $k) {
                if (is_string($biz[$k] ?? null) && trim((string) $biz[$k]) !== '') {
                    $ticket = trim((string) $biz[$k]);
                    break;
                }
            }
            return [
                'longitude' => $lng,
                'latitude' => $lat,
                'province' => is_string($p['pname'] ?? '') ? $p['pname'] : '',
                'city' => is_string($p['cityname'] ?? '') ? $p['cityname'] : '',
                'formatted' => $addrParts ? implode('', $addrParts) : (string) ($p['name'] ?? $address),
                'poiName' => (string) ($p['name'] ?? ''),
                'openHours' => $openHours,
                'ticket' => $ticket,
            ];
        }
    }

    $res = amap_get('geocode/geo', ['address' => $address, 'city' => $city], $key);
    if (!$res || ($res['status'] ?? '0') !== '1' || empty($res['geocodes'])) {
        return null;
    }
    $g = $res['geocodes'][0];
    $level = is_string($g['level'] ?? null) ? $g['level'] : '';
    if (in_array($level, ['国家', '省', '市', '区县', '开发区', '乡镇', '村庄'], true)) {
        return null;
    }
    [$lng, $lat] = array_map('floatval', explode(',', (string) ($g['location'] ?? '0,0')));
    if ($lng === 0.0 && $lat === 0.0) {
        return null;
    }
    return [
        'longitude' => $lng,
        'latitude' => $lat,
        'province' => $g['province'] ?? '',
        'city' => is_string($g['city'] ?? '') ? $g['city'] : '',
        'formatted' => $g['formatted_address'] ?? $address,
        'poiName' => '',
        'openHours' => '',
        'ticket' => '',
        'level' => $level,
    ];
}

/** 调用 DeepSeek chat 接口，返回助手文本（失败返回 null） */
function deepseek_chat(string $key, string $system, string $user, float $temperature = 0.8): ?string
{
    if ($key === '') {
        return null;
    }
    $payload = json_encode([
        'model' => 'deepseek-v4-pro',
        'messages' => [
            ['role' => 'system', 'content' => $system],
            ['role' => 'user', 'content' => $user],
        ],
        'temperature' => $temperature,
        'max_tokens' => 900,
        'stream' => false,
    ], JSON_UNESCAPED_UNICODE);
    $ctx = stream_context_create(['http' => [
        'method' => 'POST',
        'header' => "Content-Type: application/json\r\nAuthorization: Bearer {$key}\r\n",
        'content' => $payload,
        'timeout' => 30,
        'ignore_errors' => true,
    ]]);
    $raw = @file_get_contents('https://api.deepseek.com/chat/completions', false, $ctx);
    if ($raw === false) {
        return null;
    }
    $data = json_decode($raw, true);
    $text = $data['choices'][0]['message']['content'] ?? null;
    return is_string($text) ? trim($text) : null;
}

/** 调用 DeepSeek，强制返回 JSON 对象；解析失败返回 null */
function deepseek_json(string $key, string $system, string $user, float $temperature = 0.6, int $maxTokens = 1800): ?array
{
    if ($key === '') {
        return null;
    }
    $payload = json_encode([
        'model' => 'deepseek-v4-pro',
        'messages' => [
            ['role' => 'system', 'content' => $system],
            ['role' => 'user', 'content' => $user],
        ],
        'temperature' => $temperature,
        'max_tokens' => $maxTokens,
        'response_format' => ['type' => 'json_object'],
        'stream' => false,
    ], JSON_UNESCAPED_UNICODE);
    $ctx = stream_context_create(['http' => [
        'method' => 'POST',
        'header' => "Content-Type: application/json\r\nAuthorization: Bearer {$key}\r\n",
        'content' => $payload,
        'timeout' => 45,
        'ignore_errors' => true,
    ]]);
    $raw = @file_get_contents('https://api.deepseek.com/chat/completions', false, $ctx);
    if ($raw === false) {
        return null;
    }
    $data = json_decode($raw, true);
    $text = $data['choices'][0]['message']['content'] ?? null;
    if (!is_string($text)) {
        return null;
    }
    // 去除可能的 ```json 代码围栏
    $text = trim($text);
    $text = preg_replace('/^```(?:json)?\s*|\s*```$/i', '', $text);
    $parsed = json_decode($text, true);
    return is_array($parsed) ? $parsed : null;
}

try {
    $pdo = db();
    $config = require dirname(__DIR__) . '/_private/config.php';

    $isMultipart = isset($_SERVER['CONTENT_TYPE']) && stripos((string) $_SERVER['CONTENT_TYPE'], 'multipart/form-data') !== false;

    if ($isMultipart) {
        // 仅用于菜品图片上传（wx.uploadFile）
        $openid = trim((string) ($_POST['openid'] ?? ''));
        $action = (string) ($_POST['action'] ?? '');
    } else {
        $body = json_decode((string) file_get_contents('php://input'), true) ?: [];
        if ($_SERVER['REQUEST_METHOD'] === 'GET') {
            $body = $_GET;
        }
        $openid = trim((string) ($body['openid'] ?? ''));
        $action = (string) ($body['action'] ?? '');
    }

    if ($action === '') {
        fail('missing action');
    }

    /* ---------- 认领 / 校验管理员 ---------- */
    if ($action === 'claim_admin') {
        if ($openid === '') {
            fail('missing openid');
        }
        $pass = (string) ($body['passcode'] ?? '');
        $hash = (string) ($config['admin_pass_hash'] ?? '');
        if ($hash === '' || !password_verify($pass, $hash)) {
            fail('口令不正确', 403);
        }
        // openid 必须已存在于 app_users（先走过微信登录）
        $pdo->prepare(
            'INSERT INTO app_users (openid, is_admin) VALUES (?, 1)
             ON DUPLICATE KEY UPDATE is_admin = 1'
        )->execute([$openid]);
        out(['isAdmin' => true]);
    }

    if ($action === 'check_admin') {
        out(['isAdmin' => is_admin_openid($pdo, $openid)]);
    }

    if ($action === 'get_config') {
        out(['aiEnabled' => !empty($config['ai_enabled'])]);
    }

    /* 情侣共编：足迹/纪念日/行程 + 心愿单 + 记账 + 菜品/分类/订单 + 图片上传，任意已登录用户可增删改 */
    $coupleEditable = [
        'admin_journeys', 'add_journey', 'update_journey', 'del_journey', 'toggle_journey', 'reorder_journeys',
        'admin_anniversaries', 'add_anniversary', 'update_anniversary', 'del_anniversary', 'reorder_anniversaries',
        'admin_plans', 'add_plan', 'update_plan', 'del_plan', 'toggle_plan', 'reorder_plans', 'set_day_start', 'set_hotels',
        'add_stop', 'update_stop', 'del_stop', 'reorder_stops',
        'wishes', 'add_wish', 'update_wish', 'del_wish', 'toggle_wish',
        'board_messages', 'add_board_message', 'del_board_message',
        'expenses', 'add_expense', 'del_expense',
        'add_journey_photo', 'del_journey_photo',
        'geo', 'regeo', 'weather', 'ai_recommend', 'ai_place', 'ai_plan', 'import_plan', 'upload_image',
        'ai_tag', 'ai_highlights', 'add_moment', 'list_moments', 'del_moment',
        /* 菜单后台：菜品 / 分类 / 订单 —— 情侣双方都可编辑 */
        'overview', 'orders', 'set_order_status',
        'add_category', 'update_category', 'toggle_category', 'del_category', 'reorder_categories',
        'add_dish', 'update_dish', 'toggle_dish', 'del_dish', 'reorder_dishes',
        'ai_budget_analysis',
        'ai_story',
        'add_capsule', 'list_capsules', 'open_capsule',
        'add_log', 'list_logs', 'del_log',
        'ai_next_dest',
        'ai_daily_inspiration',
        'journey_compare',
    ];

    if (in_array($action, $coupleEditable, true)) {
        if (!is_known_user($pdo, $openid)) {
            fail('请先登录', 403);
        }
    } elseif (!is_admin_openid($pdo, $openid)) {
        fail('需要管理员权限', 403);
    }

    $statusLabels = ['pending' => '待处理', 'accepted' => '已接单', 'done' => '已完成', 'canceled' => '已取消'];

    switch ($action) {
        /* ============ 读取（管理视图：含隐藏/下架） ============ */
        case 'overview': {
            $cats = $pdo->query(
                'SELECT id, name, sort_order, is_visible FROM dish_categories ORDER BY sort_order ASC, id ASC'
            )->fetchAll();
            $dishes = $pdo->query(
                'SELECT id, category_id, name, description, price, image_url,
                        is_available, is_recommended, spicy_level, portion, sort_order
                 FROM dishes ORDER BY category_id ASC, sort_order ASC, id ASC'
            )->fetchAll();
            $categories = array_map(static fn ($c) => [
                'id' => (int) $c['id'],
                'name' => $c['name'],
                'sortOrder' => (int) $c['sort_order'],
                'visible' => (int) $c['is_visible'] === 1,
            ], $cats);
            $dishList = array_map(static fn ($d) => [
                'id' => (int) $d['id'],
                'categoryId' => (int) $d['category_id'],
                'name' => $d['name'],
                'description' => $d['description'],
                'price' => (float) $d['price'],
                'imageUrl' => $d['image_url'],
                'available' => (int) $d['is_available'] === 1,
                'recommended' => (int) $d['is_recommended'] === 1,
                'spicy' => (int) $d['spicy_level'],
                'portion' => $d['portion'],
                'sortOrder' => (int) $d['sort_order'],
            ], $dishes);
            out(['categories' => $categories, 'dishes' => $dishList]);
        }

        case 'orders': {
            $rows = $pdo->query(
                'SELECT id, user_openid, nickname, remark, item_count, total_amount, status, created_at
                 FROM orders ORDER BY created_at DESC, id DESC LIMIT 100'
            )->fetchAll();
            $ids = array_column($rows, 'id');
            $itemsByOrder = [];
            if ($ids) {
                $ph = implode(',', array_fill(0, count($ids), '?'));
                $is = $pdo->prepare(
                    "SELECT order_id, dish_name, price, qty, remark FROM order_items
                     WHERE order_id IN ($ph) ORDER BY id ASC"
                );
                $is->execute($ids);
                foreach ($is->fetchAll() as $it) {
                    $itemsByOrder[$it['order_id']][] = [
                        'name' => $it['dish_name'],
                        'price' => (float) $it['price'],
                        'qty' => (int) $it['qty'],
                        'remark' => $it['remark'],
                    ];
                }
            }
            $orders = array_map(static function ($o) use ($itemsByOrder, $statusLabels) {
                return [
                    'id' => $o['id'],
                    'nickname' => $o['nickname'],
                    'remark' => $o['remark'],
                    'itemCount' => (int) $o['item_count'],
                    'totalAmount' => (float) $o['total_amount'],
                    'status' => $o['status'],
                    'statusLabel' => $statusLabels[$o['status']] ?? $o['status'],
                    'createdAt' => $o['created_at'],
                    'items' => $itemsByOrder[$o['id']] ?? [],
                ];
            }, $rows);
            out(['orders' => $orders]);
        }

        /* ============ 分类 ============ */
        case 'add_category': {
            $name = trim((string) ($body['name'] ?? ''));
            if ($name === '') {
                fail('分类名不能为空');
            }
            $next = (int) $pdo->query('SELECT COALESCE(MAX(sort_order), 0) + 1 FROM dish_categories')->fetchColumn();
            $st = $pdo->prepare('INSERT INTO dish_categories (name, sort_order) VALUES (?, ?)');
            $st->execute([mb_substr($name, 0, 64), $next]);
            out(['ok' => true, 'id' => (int) $pdo->lastInsertId()]);
        }

        case 'update_category': {
            $id = (int) ($body['id'] ?? 0);
            $name = trim((string) ($body['name'] ?? ''));
            if ($id <= 0 || $name === '') {
                fail('参数不全');
            }
            $pdo->prepare('UPDATE dish_categories SET name = ? WHERE id = ?')
                ->execute([mb_substr($name, 0, 64), $id]);
            out(['ok' => true]);
        }

        case 'toggle_category': {
            $id = (int) ($body['id'] ?? 0);
            $pdo->prepare('UPDATE dish_categories SET is_visible = 1 - is_visible WHERE id = ?')->execute([$id]);
            out(['ok' => true]);
        }

        case 'del_category': {
            $id = (int) ($body['id'] ?? 0);
            $cnt = $pdo->prepare('SELECT COUNT(*) FROM dishes WHERE category_id = ?');
            $cnt->execute([$id]);
            if ((int) $cnt->fetchColumn() > 0) {
                fail('该分类下还有菜品，请先移除或删除菜品');
            }
            $pdo->prepare('DELETE FROM dish_categories WHERE id = ?')->execute([$id]);
            out(['ok' => true]);
        }

        case 'reorder_categories': {
            $ids = $body['ids'] ?? [];
            if (!is_array($ids) || !$ids) {
                fail('缺少排序');
            }
            $st = $pdo->prepare('UPDATE dish_categories SET sort_order = ? WHERE id = ?');
            $i = 1;
            foreach ($ids as $cid) {
                $st->execute([$i++, (int) $cid]);
            }
            out(['ok' => true]);
        }

        /* ============ 菜品 ============ */
        case 'add_dish':
        case 'update_dish': {
            $id = (int) ($body['id'] ?? 0);
            $catId = (int) ($body['categoryId'] ?? 0);
            $name = trim((string) ($body['name'] ?? ''));
            $desc = mb_substr(trim((string) ($body['description'] ?? '')), 0, 512);
            $price = round((float) ($body['price'] ?? 0), 2);
            $imageUrl = mb_substr(trim((string) ($body['imageUrl'] ?? '')), 0, 512);
            $isRec = !empty($body['recommended']) ? 1 : 0;
            $spicy = (int) ($body['spicy'] ?? 0);
            if ($spicy < 0 || $spicy > 3) {
                $spicy = 0;
            }
            $portion = mb_substr(trim((string) ($body['portion'] ?? '')), 0, 32);
            if ($name === '' || $catId <= 0) {
                fail('菜名与分类必填');
            }
            if ($action === 'add_dish') {
                $ns = $pdo->prepare('SELECT COALESCE(MAX(sort_order),0)+1 FROM dishes WHERE category_id = ?');
                $ns->execute([$catId]);
                $next = (int) $ns->fetchColumn();
                $st = $pdo->prepare(
                    'INSERT INTO dishes (category_id, name, description, price, image_url, is_recommended, spicy_level, portion, sort_order)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
                );
                $st->execute([$catId, mb_substr($name, 0, 128), $desc, $price, $imageUrl, $isRec, $spicy, $portion, $next]);
                out(['ok' => true, 'id' => (int) $pdo->lastInsertId()]);
            }
            if ($id <= 0) {
                fail('缺少菜品 id');
            }
            $st = $pdo->prepare(
                'UPDATE dishes SET category_id=?, name=?, description=?, price=?, image_url=?,
                    is_recommended=?, spicy_level=?, portion=? WHERE id=?'
            );
            $st->execute([$catId, mb_substr($name, 0, 128), $desc, $price, $imageUrl, $isRec, $spicy, $portion, $id]);
            out(['ok' => true]);
        }

        case 'toggle_dish': {
            $id = (int) ($body['id'] ?? 0);
            $pdo->prepare('UPDATE dishes SET is_available = 1 - is_available WHERE id = ?')->execute([$id]);
            out(['ok' => true]);
        }

        case 'del_dish': {
            $id = (int) ($body['id'] ?? 0);
            $pdo->prepare('DELETE FROM dishes WHERE id = ?')->execute([$id]);
            out(['ok' => true]);
        }

        case 'reorder_dishes': {
            $ids = $body['ids'] ?? [];
            if (!is_array($ids) || !$ids) {
                fail('缺少排序');
            }
            $st = $pdo->prepare('UPDATE dishes SET sort_order = ? WHERE id = ?');
            $i = 1;
            foreach ($ids as $did) {
                $st->execute([$i++, (int) $did]);
            }
            out(['ok' => true]);
        }

        /* ============ 订单 ============ */
        case 'set_order_status': {
            $id = (string) ($body['id'] ?? '');
            $status = (string) ($body['status'] ?? '');
            if (!isset($statusLabels[$status])) {
                fail('非法状态');
            }
            $pdo->prepare('UPDATE orders SET status = ? WHERE id = ?')->execute([$status, $id]);
            out(['ok' => true, 'statusLabel' => $statusLabels[$status]]);
        }

        /* ============ 足迹 / 城市（journeys） ============ */
        case 'admin_journeys': {
            $rows = $pdo->query(
                'SELECT id, openid, city, province, travel_date, season, weather, landmark,
                        latitude, longitude, cover_tone, title, intro, sort_order, is_visible
                 FROM journeys ORDER BY sort_order ASC, travel_date ASC, id ASC'
            )->fetchAll();
            $ids = array_column($rows, 'id');
            $tagsBy = [];
            $notesBy = [];
            $photosBy = [];
            if ($ids) {
                $ph = implode(',', array_fill(0, count($ids), '?'));
                $ts = $pdo->prepare("SELECT journey_id, name FROM journey_tags WHERE journey_id IN ($ph) ORDER BY sort_order ASC, id ASC");
                $ts->execute($ids);
                foreach ($ts->fetchAll() as $t) {
                    $tagsBy[$t['journey_id']][] = $t['name'];
                }
                $nt = $pdo->prepare("SELECT journey_id, content FROM journey_notes WHERE journey_id IN ($ph) ORDER BY sort_order ASC, id ASC");
                $nt->execute($ids);
                foreach ($nt->fetchAll() as $n) {
                    $notesBy[$n['journey_id']][] = $n['content'];
                }
                $pt = $pdo->prepare("SELECT id, journey_id, title, subtitle, tone, image_url FROM journey_photos WHERE journey_id IN ($ph) ORDER BY sort_order ASC, id ASC");
                $pt->execute($ids);
                foreach ($pt->fetchAll() as $p) {
                    $photosBy[$p['journey_id']][] = [
                        'id' => $p['id'],
                        'title' => $p['title'],
                        'subtitle' => $p['subtitle'],
                        'tone' => $p['tone'],
                        'imageUrl' => $p['image_url'],
                    ];
                }
            }
            $list = array_map(static fn ($r) => [
                'id' => $r['id'],
                'mine' => (string) ($r['openid'] ?? '') !== '' && (string) ($r['openid'] ?? '') === $openid,
                'ownerLabel' => (string) ($r['openid'] ?? '') === '' ? '我们一起补的' : (((string) $r['openid'] === $openid) ? '我添加的' : 'TA 添加的'),
                'city' => $r['city'],
                'province' => $r['province'],
                'date' => $r['travel_date'],
                'season' => $r['season'],
                'weather' => $r['weather'],
                'landmark' => $r['landmark'],
                'latitude' => (float) $r['latitude'],
                'longitude' => (float) $r['longitude'],
                'coverTone' => $r['cover_tone'],
                'title' => $r['title'],
                'intro' => $r['intro'],
                'sortOrder' => (int) $r['sort_order'],
                'visible' => (int) $r['is_visible'] === 1,
                'tags' => $tagsBy[$r['id']] ?? [],
                'notes' => $notesBy[$r['id']] ?? [],
                'photos' => $photosBy[$r['id']] ?? [],
            ], $rows);
            out(['journeys' => $list]);
        }

        case 'add_journey':
        case 'update_journey': {
            $city = mb_substr(trim((string) ($body['city'] ?? '')), 0, 64);
            $province = mb_substr(trim((string) ($body['province'] ?? '')), 0, 64);
            if ($city === '' || $province === '') {
                fail('城市与省份必填');
            }
            $date = trim((string) ($body['date'] ?? ''));
            if (!is_date($date)) {
                $date = date('Y-m-d');
            }
            $season = mb_substr(trim((string) ($body['season'] ?? '')), 0, 32);
            $weather = mb_substr(trim((string) ($body['weather'] ?? '')), 0, 64);
            $landmark = mb_substr(trim((string) ($body['landmark'] ?? '')), 0, 128);
            $lat = round((float) ($body['latitude'] ?? 0), 6);
            $lng = round((float) ($body['longitude'] ?? 0), 6);
            $tone = mb_substr(trim((string) ($body['coverTone'] ?? '')), 0, 64) ?: 'tone-slate';
            $title = mb_substr(trim((string) ($body['title'] ?? '')), 0, 128);
            $intro = trim((string) ($body['intro'] ?? ''));
            $tags = is_array($body['tags'] ?? null) ? $body['tags'] : [];
            $notes = is_array($body['notes'] ?? null) ? $body['notes'] : [];

            if ($action === 'add_journey') {
                $id = gen_id('j_');
                $next = (int) $pdo->query('SELECT COALESCE(MAX(sort_order),0)+1 FROM journeys')->fetchColumn();
                $pdo->prepare(
                    'INSERT INTO journeys (id, openid, city, province, travel_date, season, weather, landmark, latitude, longitude, cover_tone, title, intro, sort_order, is_visible)
                     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)'
                )->execute([$id, $openid, $city, $province, $date, $season, $weather, $landmark, $lat, $lng, $tone, $title, $intro, $next]);
            } else {
                $id = (string) ($body['id'] ?? '');
                if ($id === '') {
                    fail('缺少 id');
                }
                $pdo->prepare(
                    'UPDATE journeys SET city=?, province=?, travel_date=?, season=?, weather=?, landmark=?, latitude=?, longitude=?, cover_tone=?, title=?, intro=? WHERE id=?'
                )->execute([$city, $province, $date, $season, $weather, $landmark, $lat, $lng, $tone, $title, $intro, $id]);
                $pdo->prepare('DELETE FROM journey_tags WHERE journey_id=?')->execute([$id]);
                $pdo->prepare('DELETE FROM journey_notes WHERE journey_id=?')->execute([$id]);
            }
            $ti = $pdo->prepare('INSERT INTO journey_tags (journey_id, name, sort_order) VALUES (?,?,?)');
            $i = 0;
            foreach ($tags as $t) {
                $t = mb_substr(trim((string) $t), 0, 64);
                if ($t !== '') {
                    $ti->execute([$id, $t, $i++]);
                }
            }
            $nid = $pdo->prepare('INSERT INTO journey_notes (journey_id, content, sort_order) VALUES (?,?,?)');
            $i = 0;
            foreach ($notes as $n) {
                $n = trim((string) $n);
                if ($n !== '') {
                    $nid->execute([$id, $n, $i++]);
                }
            }
            out(['ok' => true, 'id' => $id]);
        }

        case 'toggle_journey': {
            $id = (string) ($body['id'] ?? '');
            $pdo->prepare('UPDATE journeys SET is_visible = 1 - is_visible WHERE id = ?')->execute([$id]);
            out(['ok' => true]);
        }

        case 'del_journey': {
            $id = (string) ($body['id'] ?? '');
            $pdo->prepare('DELETE FROM journeys WHERE id = ?')->execute([$id]);
            out(['ok' => true]);
        }

        case 'reorder_journeys': {
            $ids = $body['ids'] ?? [];
            if (!is_array($ids) || !$ids) {
                fail('缺少排序');
            }
            $st = $pdo->prepare('UPDATE journeys SET sort_order = ? WHERE id = ?');
            $i = 1;
            foreach ($ids as $jid) {
                $st->execute([$i++, (string) $jid]);
            }
            out(['ok' => true]);
        }

        /* ============ 纪念日 / 时间（anniversaries） ============ */
        case 'admin_anniversaries': {
            $rows = $pdo->query(
                'SELECT id, label, event_date, city, repeat_yearly, sort_order
                 FROM anniversaries ORDER BY sort_order ASC, event_date ASC, id ASC'
            )->fetchAll();
            $list = array_map(static fn ($r) => [
                'id' => $r['id'],
                'label' => $r['label'],
                'date' => $r['event_date'],
                'city' => $r['city'],
                'repeatYearly' => (int) ($r['repeat_yearly'] ?? 0) === 1,
                'sortOrder' => (int) $r['sort_order'],
            ], $rows);
            out(['anniversaries' => $list]);
        }

        case 'add_anniversary':
        case 'update_anniversary': {
            $label = mb_substr(trim((string) ($body['label'] ?? '')), 0, 128);
            $date = trim((string) ($body['date'] ?? ''));
            $city = mb_substr(trim((string) ($body['city'] ?? '')), 0, 64);
            $repeat = !empty($body['repeatYearly']) ? 1 : 0;
            if ($label === '' || !is_date($date)) {
                fail('名称与日期必填');
            }
            if ($action === 'add_anniversary') {
                $id = gen_id('a_');
                $next = (int) $pdo->query('SELECT COALESCE(MAX(sort_order),0)+1 FROM anniversaries')->fetchColumn();
                $pdo->prepare('INSERT INTO anniversaries (id, label, event_date, city, repeat_yearly, sort_order) VALUES (?,?,?,?,?,?)')
                    ->execute([$id, $label, $date, $city, $repeat, $next]);
                out(['ok' => true, 'id' => $id]);
            }
            $id = (string) ($body['id'] ?? '');
            if ($id === '') {
                fail('缺少 id');
            }
            $pdo->prepare('UPDATE anniversaries SET label=?, event_date=?, city=?, repeat_yearly=? WHERE id=?')
                ->execute([$label, $date, $city, $repeat, $id]);
            out(['ok' => true]);
        }

        case 'del_anniversary': {
            $id = (string) ($body['id'] ?? '');
            $pdo->prepare('DELETE FROM anniversaries WHERE id = ?')->execute([$id]);
            out(['ok' => true]);
        }

        case 'reorder_anniversaries': {
            $ids = $body['ids'] ?? [];
            if (!is_array($ids) || !$ids) {
                fail('缺少排序');
            }
            $st = $pdo->prepare('UPDATE anniversaries SET sort_order = ? WHERE id = ?');
            $i = 1;
            foreach ($ids as $aid) {
                $st->execute([$i++, (string) $aid]);
            }
            out(['ok' => true]);
        }

        /* ============ 旅行计划 / 行程（trip_plans + plan_stops） ============ */
        case 'admin_plans': {
            $plans = $pdo->query(
                'SELECT id, title, cover_tone, plan_date, plan_date_end, cover_image_url, note,
                        hotel_name, hotel_address, hotel_lat, hotel_lng, hotels, day_starts, sort_order, is_visible
                 FROM trip_plans ORDER BY sort_order ASC, created_at DESC, id ASC'
            )->fetchAll();
            $ids = array_column($plans, 'id');
            $stopsBy = [];
            if ($ids) {
                $ph = implode(',', array_fill(0, count($ids), '?'));
                $ss = $pdo->prepare(
                    "SELECT id, plan_id, name, address, latitude, longitude, note, open_hours, ticket, booking_url, planned_time, stay_minutes, day, sort_order
                     FROM plan_stops WHERE plan_id IN ($ph) ORDER BY sort_order ASC, id ASC"
                );
                $ss->execute($ids);
                foreach ($ss->fetchAll() as $s) {
                    $stopsBy[$s['plan_id']][] = [
                        'id' => (int) $s['id'],
                        'name' => $s['name'],
                        'address' => $s['address'],
                        'latitude' => $s['latitude'] === null ? null : (float) $s['latitude'],
                        'longitude' => $s['longitude'] === null ? null : (float) $s['longitude'],
                        'note' => $s['note'],
                        'openHours' => $s['open_hours'] ?? '',
                        'ticket' => $s['ticket'] ?? '',
                        'bookingUrl' => $s['booking_url'] ?? '',
                        'plannedTime' => $s['planned_time'],
                        'stayMinutes' => (int) ($s['stay_minutes'] ?? 0),
                        'day' => (int) ($s['day'] ?? 1),
                        'sortOrder' => (int) $s['sort_order'],
                    ];
                }
            }
            $list = array_map(static function ($p) use ($stopsBy) {
                $places = plan_places_admin($p);
                return [
                    'id' => $p['id'],
                    'title' => $p['title'],
                    'coverTone' => $p['cover_tone'],
                    'planDate' => $p['plan_date'],
                    'planDateEnd' => $p['plan_date_end'],
                    'coverImageUrl' => $p['cover_image_url'],
                    'note' => $p['note'],
                    'hotel' => $places['hotel'],
                    'hotels' => $places['hotels'],
                    'dayStarts' => $places['dayStarts'],
                    'sortOrder' => (int) $p['sort_order'],
                    'visible' => (int) $p['is_visible'] === 1,
                    'stops' => $stopsBy[$p['id']] ?? [],
                ];
            }, $plans);
            out(['plans' => $list]);
        }

        case 'add_plan':
        case 'update_plan': {
            $title = mb_substr(trim((string) ($body['title'] ?? '')), 0, 128);
            if ($title === '') {
                fail('计划标题必填');
            }
            $tone = mb_substr(trim((string) ($body['coverTone'] ?? '')), 0, 64) ?: 'tone-slate';
            $planDate = trim((string) ($body['planDate'] ?? ''));
            $planDate = is_date($planDate) ? $planDate : null;
            $planDateEnd = trim((string) ($body['planDateEnd'] ?? ''));
            $planDateEnd = is_date($planDateEnd) ? $planDateEnd : null;
            // 结束日期不得早于开始日期，否则忽略
            if ($planDate && $planDateEnd && $planDateEnd < $planDate) {
                $planDateEnd = null;
            }
            $coverImage = mb_substr(trim((string) ($body['coverImageUrl'] ?? '')), 0, 512);
            $note = trim((string) ($body['note'] ?? ''));
            $hotelName = mb_substr(trim((string) ($body['hotelName'] ?? '')), 0, 128);
            $hotelAddr = mb_substr(trim((string) ($body['hotelAddress'] ?? '')), 0, 256);
            $hotelLat = norm_coord($body['hotelLat'] ?? null);
            $hotelLng = norm_coord($body['hotelLng'] ?? null);
            if ($action === 'add_plan') {
                $id = gen_id('p_');
                $next = (int) $pdo->query('SELECT COALESCE(MAX(sort_order),0)+1 FROM trip_plans')->fetchColumn();
                $pdo->prepare('INSERT INTO trip_plans (id, title, cover_tone, plan_date, plan_date_end, cover_image_url, note, hotel_name, hotel_address, hotel_lat, hotel_lng, sort_order) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
                    ->execute([$id, $title, $tone, $planDate, $planDateEnd, $coverImage, $note, $hotelName, $hotelAddr, $hotelLat, $hotelLng, $next]);
                out(['ok' => true, 'id' => $id]);
            }
            $id = (string) ($body['id'] ?? '');
            if ($id === '') {
                fail('缺少 id');
            }
            $pdo->prepare('UPDATE trip_plans SET title=?, cover_tone=?, plan_date=?, plan_date_end=?, cover_image_url=?, note=?, hotel_name=?, hotel_address=?, hotel_lat=?, hotel_lng=? WHERE id=?')
                ->execute([$title, $tone, $planDate, $planDateEnd, $coverImage, $note, $hotelName, $hotelAddr, $hotelLat, $hotelLng, $id]);
            out(['ok' => true]);
        }

        case 'set_day_start': {
            $id = (string) ($body['id'] ?? '');
            if ($id === '') {
                fail('缺少 id');
            }
            $day = max(1, min(60, (int) ($body['day'] ?? 0)));
            if ($day < 1) {
                fail('无效的天数');
            }
            $row = $pdo->prepare('SELECT day_starts FROM trip_plans WHERE id = ?');
            $row->execute([$id]);
            $raw = $row->fetchColumn();
            $map = [];
            if (is_string($raw) && $raw !== '') {
                $decoded = json_decode($raw, true);
                if (is_array($decoded)) {
                    $map = $decoded;
                }
            }
            if (!empty($body['clear'])) {
                // 恢复默认：删除该天的自定义出发点（回落到酒店）
                unset($map[(string) $day]);
            } else {
                $map[(string) $day] = [
                    'name' => mb_substr(trim((string) ($body['name'] ?? '')), 0, 128),
                    'address' => mb_substr(trim((string) ($body['address'] ?? '')), 0, 256),
                    'lat' => norm_coord($body['lat'] ?? null),
                    'lng' => norm_coord($body['lng'] ?? null),
                ];
            }
            $json = $map ? json_encode($map, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) : null;
            $pdo->prepare('UPDATE trip_plans SET day_starts = ? WHERE id = ?')->execute([$json, $id]);
            out(['ok' => true]);
        }

        /* ============ 多晚/分段住宿：整组覆盖保存 ============ */
        case 'set_hotels': {
            $id = (string) ($body['id'] ?? '');
            if ($id === '') {
                fail('缺少 id');
            }
            $in = $body['hotels'] ?? [];
            if (!is_array($in)) {
                $in = [];
            }
            $clean = [];
            foreach ($in as $h) {
                if (!is_array($h)) {
                    continue;
                }
                $name = mb_substr(trim((string) ($h['name'] ?? '')), 0, 128);
                $lat = norm_coord($h['lat'] ?? null);
                if ($name === '' && $lat === null) {
                    continue;
                }
                $sd = max(1, min(60, (int) ($h['startDay'] ?? 1)));
                $ed = max($sd, min(60, (int) ($h['endDay'] ?? $sd)));
                $clean[] = [
                    'name' => $name,
                    'address' => mb_substr(trim((string) ($h['address'] ?? '')), 0, 256),
                    'lat' => $lat,
                    'lng' => norm_coord($h['lng'] ?? null),
                    'startDay' => $sd,
                    'endDay' => $ed,
                ];
            }
            $json = $clean ? json_encode($clean, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) : null;
            $pdo->prepare('UPDATE trip_plans SET hotels = ? WHERE id = ?')->execute([$json, $id]);
            out(['ok' => true, 'hotels' => $clean]);
        }

        case 'toggle_plan': {
            $id = (string) ($body['id'] ?? '');
            $pdo->prepare('UPDATE trip_plans SET is_visible = 1 - is_visible WHERE id = ?')->execute([$id]);
            out(['ok' => true]);
        }

        case 'del_plan': {
            $id = (string) ($body['id'] ?? '');
            $pdo->prepare('DELETE FROM trip_plans WHERE id = ?')->execute([$id]);
            out(['ok' => true]);
        }

        case 'reorder_plans': {
            $ids = $body['ids'] ?? [];
            if (!is_array($ids) || !$ids) {
                fail('缺少排序');
            }
            $st = $pdo->prepare('UPDATE trip_plans SET sort_order = ? WHERE id = ?');
            $i = 1;
            foreach ($ids as $pid) {
                $st->execute([$i++, (string) $pid]);
            }
            out(['ok' => true]);
        }

        case 'add_stop':
        case 'update_stop': {
            $planId = (string) ($body['planId'] ?? '');
            $name = mb_substr(trim((string) ($body['name'] ?? '')), 0, 128);
            if ($name === '') {
                fail('地点名称必填');
            }
            $address = mb_substr(trim((string) ($body['address'] ?? '')), 0, 255);
            $note = trim((string) ($body['note'] ?? ''));
            $openHours = mb_substr(trim((string) ($body['openHours'] ?? '')), 0, 255);
            $ticket = mb_substr(trim((string) ($body['ticket'] ?? '')), 0, 255);
            $bookingUrl = mb_substr(trim((string) ($body['bookingUrl'] ?? '')), 0, 512);
            $plannedTime = mb_substr(trim((string) ($body['plannedTime'] ?? '')), 0, 32);
            $stayMinutes = max(0, min(1440, (int) ($body['stayMinutes'] ?? 0)));
            $day = max(1, min(60, (int) ($body['day'] ?? 1)));
            $lat = isset($body['latitude']) && $body['latitude'] !== '' ? round((float) $body['latitude'], 6) : null;
            $lng = isset($body['longitude']) && $body['longitude'] !== '' ? round((float) $body['longitude'], 6) : null;
            if ($action === 'add_stop') {
                if ($planId === '') {
                    fail('缺少 planId');
                }
                $ns = $pdo->prepare('SELECT COALESCE(MAX(sort_order),0)+1 FROM plan_stops WHERE plan_id = ?');
                $ns->execute([$planId]);
                $order = (int) $ns->fetchColumn();
                $pdo->prepare('INSERT INTO plan_stops (plan_id, name, address, latitude, longitude, note, open_hours, ticket, booking_url, planned_time, stay_minutes, day, sort_order) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
                    ->execute([$planId, $name, $address, $lat, $lng, $note, $openHours, $ticket, $bookingUrl, $plannedTime, $stayMinutes, $day, $order]);
                out(['ok' => true, 'id' => (int) $pdo->lastInsertId()]);
            }
            $id = (int) ($body['id'] ?? 0);
            if ($id <= 0) {
                fail('缺少 id');
            }
            $pdo->prepare('UPDATE plan_stops SET name=?, address=?, latitude=?, longitude=?, note=?, open_hours=?, ticket=?, booking_url=?, planned_time=?, stay_minutes=?, day=? WHERE id=?')
                ->execute([$name, $address, $lat, $lng, $note, $openHours, $ticket, $bookingUrl, $plannedTime, $stayMinutes, $day, $id]);
            out(['ok' => true]);
        }

        case 'del_stop': {
            $id = (int) ($body['id'] ?? 0);
            $pdo->prepare('DELETE FROM plan_stops WHERE id = ?')->execute([$id]);
            out(['ok' => true]);
        }

        case 'reorder_stops': {
            $ids = $body['ids'] ?? [];
            if (!is_array($ids) || !$ids) {
                fail('缺少排序');
            }
            $st = $pdo->prepare('UPDATE plan_stops SET sort_order = ? WHERE id = ?');
            $i = 1;
            foreach ($ids as $sid) {
                $st->execute([$i++, (int) $sid]);
            }
            out(['ok' => true]);
        }

        /* ============ 高德地理编码（地址 → 经纬度，编辑器自动填坐标） ============ */
        case 'geo': {
            $key = (string) ($config['amap_key'] ?? '');
            if ($key === '') {
                fail('未配置高德 key', 503);
            }
            $address = trim((string) ($body['address'] ?? ''));
            $city = trim((string) ($body['city'] ?? ''));
            if ($address === '') {
                fail('缺少地址');
            }
            $geo = amap_lookup_place($key, $address, $city);
            if (!$geo && $city !== '' && mb_strpos($address, $city) === false) {
                $geo = amap_lookup_place($key, $city . ' ' . $address, $city);
            }
            if (!$geo) {
                fail('未找到该地点', 404);
            }
            out([
                'ok' => true,
                'longitude' => $geo['longitude'],
                'latitude' => $geo['latitude'],
                'province' => $geo['province'] ?? '',
                'city' => $geo['city'] ?? '',
                'formatted' => $geo['formatted'] ?? $address,
                'poiName' => $geo['poiName'] ?? '',
                'openHours' => $geo['openHours'] ?? '',
                'ticket' => $geo['ticket'] ?? '',
            ]);
        }

        /* ============ 高德逆地理编码（当前定位经纬度 → 省/市，足迹「定位当前位置」） ============ */
        case 'regeo': {
            $key = (string) ($config['amap_key'] ?? '');
            if ($key === '') {
                fail('未配置高德 key', 503);
            }
            $lng = isset($body['longitude']) ? (float) $body['longitude'] : 0.0;
            $lat = isset($body['latitude']) ? (float) $body['latitude'] : 0.0;
            if ($lng === 0.0 || $lat === 0.0) {
                fail('缺少经纬度');
            }
            $res = amap_get('geocode/regeo', ['location' => $lng . ',' . $lat, 'extensions' => 'base'], $key);
            if (!$res || ($res['status'] ?? '0') !== '1' || empty($res['regeocode'])) {
                fail('未找到该位置', 404);
            }
            $comp = $res['regeocode']['addressComponent'] ?? [];
            $province = is_string($comp['province'] ?? '') ? $comp['province'] : '';
            // 直辖市的 city 为空数组，退回到 district（如 北京市→朝阳区）
            $city = (isset($comp['city']) && is_string($comp['city']) && $comp['city'] !== '')
                ? $comp['city']
                : (is_string($comp['district'] ?? '') ? $comp['district'] : '');
            out([
                'ok' => true,
                'longitude' => $lng,
                'latitude' => $lat,
                'province' => $province,
                'city' => $city,
                'formatted' => (string) ($res['regeocode']['formatted_address'] ?? ''),
            ]);
        }

        /* ============ 高德天气（经纬度 → adcode → 4 天预报，行程页按计划日期显示） ============ */
        case 'weather': {
            $key = (string) ($config['amap_key'] ?? '');
            if ($key === '') {
                fail('未配置高德 key', 503);
            }
            $adcode = preg_replace('/\D/', '', (string) ($body['adcode'] ?? ''));
            if ($adcode === '') {
                $lng = isset($body['longitude']) ? (float) $body['longitude'] : 0.0;
                $lat = isset($body['latitude']) ? (float) $body['latitude'] : 0.0;
                if ($lng === 0.0 || $lat === 0.0) {
                    fail('缺少经纬度或 adcode');
                }
                $re = amap_get('geocode/regeo', ['location' => $lng . ',' . $lat, 'extensions' => 'base'], $key);
                $adcode = (string) ($re['regeocode']['addressComponent']['adcode'] ?? '');
                if ($adcode === '') {
                    fail('未能定位城市', 404);
                }
            }
            $w = amap_get('weather/weatherInfo', ['city' => $adcode, 'extensions' => 'all'], $key);
            if (!$w || ($w['status'] ?? '0') !== '1' || empty($w['forecasts'][0])) {
                fail('未能获取天气', 404);
            }
            $f = $w['forecasts'][0];
            $casts = [];
            foreach (($f['casts'] ?? []) as $c) {
                $casts[] = [
                    'date' => (string) ($c['date'] ?? ''),
                    'week' => (string) ($c['week'] ?? ''),
                    'dayWeather' => (string) ($c['dayweather'] ?? ''),
                    'nightWeather' => (string) ($c['nightweather'] ?? ''),
                    'dayTemp' => (string) ($c['daytemp'] ?? ''),
                    'nightTemp' => (string) ($c['nighttemp'] ?? ''),
                    'dayWind' => (string) ($c['daywind'] ?? ''),
                    'dayPower' => (string) ($c['daypower'] ?? ''),
                ];
            }
            out([
                'ok' => true,
                'adcode' => $adcode,
                'city' => (string) ($f['city'] ?? ''),
                'province' => (string) ($f['province'] ?? ''),
                'reportTime' => (string) ($f['reporttime'] ?? ''),
                'casts' => $casts,
            ]);
        }

        /* ============ 图片上传（multipart） ============ */
        case 'upload_image': {
            if (empty($_FILES['image']['tmp_name']) || !is_uploaded_file($_FILES['image']['tmp_name'])) {
                fail('未收到图片');
            }
            if (($_FILES['image']['size'] ?? 0) > 6 * 1024 * 1024) {
                fail('图片过大（上限 6MB）');
            }
            $tmp = $_FILES['image']['tmp_name'];
            $info = @getimagesize($tmp);
            $allowed = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp', 'image/gif' => 'gif'];
            if (!$info || !isset($allowed[$info['mime']])) {
                fail('仅支持 jpg/png/webp/gif');
            }
            $uploadDir = $config['upload_dir'] ?? (dirname(__DIR__) . '/uploads');
            $uploadBase = $config['upload_base'] ?? '/uploads';
            $dir = rtrim($uploadDir, '/') . '/dishes';
            if (!is_dir($dir)) {
                @mkdir($dir, 0755, true);
            }
            $fn = date('Ymd') . '_' . bin2hex(random_bytes(6)) . '.' . $allowed[$info['mime']];
            if (!move_uploaded_file($tmp, $dir . '/' . $fn)) {
                fail('保存失败', 500);
            }
            out(['ok' => true, 'imageUrl' => rtrim($uploadBase, '/') . '/dishes/' . $fn]);
        }

        /* ============ 心愿清单（想去的地方）：情侣共编 ============ */
        case 'wishes': {
            $rows = $pdo->query(
                'SELECT id, openid, place_name, province, city, latitude, longitude, memo, done, completed_date, sort_order
                 FROM desire_list ORDER BY done ASC, sort_order ASC, created_at DESC'
            )->fetchAll();
            $list = array_map(static fn ($r) => [
                'id' => $r['id'],
                'mine' => (string) ($r['openid'] ?? '') !== '' && (string) ($r['openid'] ?? '') === $openid,
                'ownerLabel' => (string) ($r['openid'] ?? '') === '' ? '一起想去' : (((string) $r['openid'] === $openid) ? '我想去' : 'TA 想去'),
                'placeName' => $r['place_name'],
                'province' => $r['province'],
                'city' => $r['city'],
                'latitude' => $r['latitude'] !== null ? (float) $r['latitude'] : null,
                'longitude' => $r['longitude'] !== null ? (float) $r['longitude'] : null,
                'memo' => $r['memo'],
                'done' => (int) $r['done'] === 1,
                'completedDate' => $r['completed_date'] ?? null,
                'sortOrder' => (int) $r['sort_order'],
            ], $rows);
            out(['wishes' => $list]);
        }

        case 'add_wish':
        case 'update_wish': {
            $placeName = trim((string) ($body['placeName'] ?? ''));
            if ($placeName === '') {
                fail('缺少地点名称');
            }
            $province = trim((string) ($body['province'] ?? ''));
            $city = trim((string) ($body['city'] ?? ''));
            $memo = trim((string) ($body['memo'] ?? ''));
            $lat = isset($body['latitude']) && $body['latitude'] !== '' ? (float) $body['latitude'] : null;
            $lng = isset($body['longitude']) && $body['longitude'] !== '' ? (float) $body['longitude'] : null;
            if ($action === 'add_wish') {
                $id = gen_id('wish_');
                $maxOrder = (int) $pdo->query('SELECT COALESCE(MAX(sort_order), 0) FROM desire_list')->fetchColumn();
                $pdo->prepare(
                    'INSERT INTO desire_list (id, openid, place_name, province, city, latitude, longitude, memo, sort_order)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
                )->execute([$id, $openid, $placeName, $province, $city, $lat, $lng, $memo, $maxOrder + 1]);
                out(['ok' => true, 'id' => $id]);
            }
            $id = (string) ($body['id'] ?? '');
            if ($id === '') {
                fail('缺少 id');
            }
            $pdo->prepare(
                'UPDATE desire_list SET place_name=?, province=?, city=?, latitude=?, longitude=?, memo=? WHERE id=?'
            )->execute([$placeName, $province, $city, $lat, $lng, $memo, $id]);
            out(['ok' => true]);
        }

        case 'toggle_wish': {
            $id = (string) ($body['id'] ?? '');
            if ($id === '') {
                fail('缺少 id');
            }
            // 完成时记录打卡日期；取消完成则清空
            // 注意：MySQL 同一 SET 子句按从左到右用「更新后」的值，故先据原 done 算日期再翻转
            $pdo->prepare(
                'UPDATE desire_list
                 SET completed_date = CASE WHEN done = 0 THEN CURDATE() ELSE NULL END,
                     done = 1 - done
                 WHERE id = ?'
            )->execute([$id]);
            out(['ok' => true]);
        }

        case 'del_wish': {
            $id = (string) ($body['id'] ?? '');
            $pdo->prepare('DELETE FROM desire_list WHERE id = ?')->execute([$id]);
            out(['ok' => true]);
        }

        /* ============ 情侣留言板：仅已登录的两个人共看共写 ============ */
        case 'board_messages': {
            ensure_couple_messages_table($pdo);
            $limit = min(80, max(1, (int) ($body['limit'] ?? 50)));
            $rows = $pdo->query(
                'SELECT id, openid, nickname, avatar_url, content, created_at
                 FROM couple_messages
                 WHERE deleted_at IS NULL
                 ORDER BY created_at DESC, id DESC
                 LIMIT ' . $limit
            )->fetchAll();
            $messages = array_map(static fn ($r) => [
                'id' => $r['id'],
                'mine' => (string) $r['openid'] === $openid,
                'authorLabel' => (string) $r['openid'] === $openid ? '我' : 'TA',
                'nickname' => $r['nickname'] ?: ((string) $r['openid'] === $openid ? '我' : 'TA'),
                'avatarUrl' => $r['avatar_url'] ?: '',
                'content' => $r['content'],
                'createdAt' => $r['created_at'],
            ], $rows);
            out(['ok' => true, 'messages' => $messages]);
        }

        case 'add_board_message': {
            ensure_couple_messages_table($pdo);
            $content = trim((string) ($body['content'] ?? ''));
            if ($content === '') {
                fail('留言不能为空');
            }
            $content = mb_substr($content, 0, 300);
            $userRow = $pdo->prepare('SELECT nickname, avatar_url FROM app_users WHERE openid = ?');
            $userRow->execute([$openid]);
            $user = $userRow->fetch() ?: [];
            $id = gen_id('msg_');
            $pdo->prepare(
                'INSERT INTO couple_messages (id, openid, nickname, avatar_url, content)
                 VALUES (?, ?, ?, ?, ?)'
            )->execute([
                $id,
                $openid,
                mb_substr((string) ($user['nickname'] ?? ''), 0, 64),
                mb_substr((string) ($user['avatar_url'] ?? ''), 0, 512),
                $content,
            ]);
            out(['ok' => true, 'id' => $id]);
        }

        case 'del_board_message': {
            ensure_couple_messages_table($pdo);
            $id = (string) ($body['id'] ?? '');
            if ($id === '') {
                fail('缺少 id');
            }
            $st = $pdo->prepare('SELECT openid FROM couple_messages WHERE id = ? AND deleted_at IS NULL');
            $st->execute([$id]);
            $owner = (string) ($st->fetchColumn() ?: '');
            if ($owner === '') {
                fail('留言不存在', 404);
            }
            if ($owner !== $openid && !is_admin_openid($pdo, $openid)) {
                fail('只能删除自己的留言', 403);
            }
            $pdo->prepare('UPDATE couple_messages SET deleted_at = NOW() WHERE id = ?')->execute([$id]);
            out(['ok' => true]);
        }

        /* ============ 预算花费记账：按行程 / 城市 ============ */
        case 'expenses': {
            $planId = (string) ($body['planId'] ?? '');
            $city = trim((string) ($body['city'] ?? ''));
            $where = [];
            $args = [];
            if ($planId !== '') {
                $where[] = 'plan_id = ?';
                $args[] = $planId;
            }
            if ($city !== '') {
                $where[] = 'city = ?';
                $args[] = $city;
            }
            $sql = 'SELECT id, plan_id, journey_id, city, category, amount, spend_date, memo
                    FROM trip_expenses';
            if ($where) {
                $sql .= ' WHERE ' . implode(' AND ', $where);
            }
            $sql .= ' ORDER BY spend_date DESC, created_at DESC';
            $st = $pdo->prepare($sql);
            $st->execute($args);
            $rows = $st->fetchAll();
            $total = 0.0;
            $byCategory = [];
            $list = array_map(static function ($r) use (&$total, &$byCategory) {
                $amt = (float) $r['amount'];
                $total += $amt;
                $cat = $r['category'] ?: 'other';
                $byCategory[$cat] = ($byCategory[$cat] ?? 0) + $amt;
                return [
                    'id' => $r['id'],
                    'planId' => $r['plan_id'],
                    'journeyId' => $r['journey_id'],
                    'city' => $r['city'],
                    'category' => $cat,
                    'amount' => $amt,
                    'date' => $r['spend_date'],
                    'memo' => $r['memo'],
                ];
            }, $rows);
            out(['expenses' => $list, 'total' => round($total, 2), 'byCategory' => $byCategory]);
        }

        case 'add_expense': {
            $amount = (float) ($body['amount'] ?? 0);
            if ($amount <= 0) {
                fail('金额需大于 0');
            }
            $id = gen_id('exp_');
            $date = trim((string) ($body['date'] ?? ''));
            if (!is_date($date)) {
                $date = date('Y-m-d');
            }
            $pdo->prepare(
                'INSERT INTO trip_expenses (id, openid, plan_id, journey_id, city, category, amount, spend_date, memo)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
            )->execute([
                $id,
                $openid,
                (string) ($body['planId'] ?? ''),
                (string) ($body['journeyId'] ?? ''),
                trim((string) ($body['city'] ?? '')),
                trim((string) ($body['category'] ?? 'other')),
                $amount,
                $date,
                trim((string) ($body['memo'] ?? '')),
            ]);
            out(['ok' => true, 'id' => $id]);
        }

        case 'del_expense': {
            $id = (string) ($body['id'] ?? '');
            $pdo->prepare('DELETE FROM trip_expenses WHERE id = ?')->execute([$id]);
            out(['ok' => true]);
        }

        /* ============ 打卡照片墙：给某段足迹追加 / 删除照片 ============ */
        case 'add_journey_photo': {
            $journeyId = (string) ($body['journeyId'] ?? '');
            $imageUrl = trim((string) ($body['imageUrl'] ?? ''));
            if ($journeyId === '' || $imageUrl === '') {
                fail('缺少 journeyId 或 imageUrl');
            }
            $id = gen_id('ph_');
            $maxOrder = (int) $pdo->query('SELECT COALESCE(MAX(sort_order), 0) FROM journey_photos')->fetchColumn();
            $pdo->prepare(
                'INSERT INTO journey_photos (id, journey_id, title, subtitle, tone, image_url, sort_order)
                 VALUES (?, ?, ?, ?, ?, ?, ?)'
            )->execute([
                $id,
                $journeyId,
                trim((string) ($body['title'] ?? '')),
                trim((string) ($body['subtitle'] ?? '')),
                trim((string) ($body['tone'] ?? 'tone-ink')),
                $imageUrl,
                $maxOrder + 1,
            ]);
            out(['ok' => true, 'id' => $id]);
        }

        case 'del_journey_photo': {
            $id = (string) ($body['id'] ?? '');
            $pdo->prepare('DELETE FROM journey_photos WHERE id = ?')->execute([$id]);
            out(['ok' => true]);
        }

        /* ============ DeepSeek AI 推荐：景区问答 / 按口味菜系点菜 ============ */
        case 'ai_recommend': {
            if (empty($config['ai_enabled'])) { fail('功能未开放', 503); }
            $key = (string) ($config['deepseek_key'] ?? '');
            if ($key === '') {
                fail('未配置 DeepSeek key', 503);
            }
            $mode = (string) ($body['mode'] ?? 'scene');
            $query = trim((string) ($body['query'] ?? ''));
            if ($query === '') {
                fail('请输入内容');
            }
            if ($mode === 'dish') {
                $system = '你是一位懂中国各大菜系的点菜顾问。用户会给出想吃的口味、菜系、食材或场景，'
                    . '你推荐 3-5 道具体菜品。每道菜用一行，格式：「菜名 — 一句话理由（口味/做法/适合谁）」。'
                    . '只输出菜品列表，不要寒暄、不要多余解释。';
                $user = '需求：' . $query;
                $temp = 0.9;
            } else {
                $city = trim((string) ($body['city'] ?? ''));
                $system = '你是一位本地向导，熟悉中国各地景点、人文与美食。回答要具体、实用、温暖，'
                    . '适合情侣出游参考。控制在 200 字以内，可用短小分点。';
                $user = ($city !== '' ? "城市/地点：{$city}。" : '') . '问题：' . $query;
                $temp = 0.7;
            }
            $text = deepseek_chat($key, $system, $user, $temp);
            if ($text === null || $text === '') {
                fail('AI 暂时不可用，请稍后再试', 502);
            }
            out(['ok' => true, 'mode' => $mode, 'answer' => $text]);
        }

        /* ============ AI 地点介绍：怎么玩 / 怎么逛 / 附近美食 / 贴士 ============ */
        case 'ai_place': {
            if (empty($config['ai_enabled'])) { fail('功能未开放', 503); }
            $key = (string) ($config['deepseek_key'] ?? '');
            if ($key === '') {
                fail('未配置 DeepSeek key', 503);
            }
            $place = trim((string) ($body['place'] ?? $body['city'] ?? ''));
            if ($place === '') {
                fail('请填写地点');
            }
            $system = '你是一位贴心的本地向导，熟悉中国各地景点、玩法与美食，服务对象是情侣出游。'
                . '请用 JSON 返回，键固定为：intro（一句话简介，30字内）、play（数组，2-4 条「怎么玩」要点，每条15字内）、'
                . 'walk（数组，2-4 条「怎么逛/路线建议」，每条20字内）、food（数组，3-5 条附近美食/小吃，每条「名称 — 一句推荐理由」）、'
                . 'tips（数组，2-3 条实用贴士，如最佳时间/避坑/穿搭）。只输出 JSON，不要寒暄。';
            $user = '地点：' . $place;
            $data = deepseek_json($key, $system, $user, 0.7, 1200);
            if (!is_array($data)) {
                fail('AI 暂时不可用，请稍后再试', 502);
            }
            out(['ok' => true, 'place' => $place, 'detail' => $data]);
        }

        /* ============ AI 生成行程攻略（结构化，可一键导入计划） ============ */
        case 'ai_plan': {
            if (empty($config['ai_enabled'])) { fail('功能未开放', 503); }
            $key = (string) ($config['deepseek_key'] ?? '');
            if ($key === '') {
                fail('未配置 DeepSeek key', 503);
            }
            $city = trim((string) ($body['city'] ?? ''));
            if ($city === '') {
                fail('请填写城市/目的地');
            }
            $days = max(1, min(10, (int) ($body['days'] ?? 2)));
            $prefs = mb_substr(trim((string) ($body['prefs'] ?? '')), 0, 200);
            $system = '你是资深旅行规划师，为情侣定制行程。请用 JSON 返回，键固定为：'
                . 'title（行程标题，含城市与天数，20字内）、intro（一句话亮点，40字内）、'
                . 'days（数组，长度等于天数；每个元素为 {day:第几天的数字, theme:当天主题(15字内), '
                . 'stops:数组，每天3-5个地点，每个为 {name:地点名(20字内), time:建议时段(如"上午"/"14:00"), desc:一句玩法说明(30字内)}}）、'
                . 'foods（数组，4-6 条当地美食，每条「名称 — 一句推荐」）、tips（数组，2-3 条实用贴士）。'
                . '地点要真实存在、顺路合理。只输出 JSON，不要寒暄。';
            $user = "目的地：{$city}；天数：{$days} 天" . ($prefs !== '' ? "；偏好：{$prefs}" : '') . '。';
            $data = deepseek_json($key, $system, $user, 0.6, 2200);
            if (!is_array($data) || empty($data['days'])) {
                fail('AI 暂时不可用，请稍后再试', 502);
            }
            out(['ok' => true, 'city' => $city, 'days' => $days, 'plan' => $data]);
        }

        /* ============ 把 AI 攻略一键导入为「我的计划」+ 行程地点 ============ */
        case 'import_plan': {
            $title = mb_substr(trim((string) ($body['title'] ?? '')), 0, 128);
            if ($title === '') {
                fail('计划标题必填');
            }
            $tone = mb_substr(trim((string) ($body['coverTone'] ?? '')), 0, 64) ?: 'tone-slate';
            $planDate = trim((string) ($body['planDate'] ?? ''));
            $planDate = is_date($planDate) ? $planDate : null;
            $city = mb_substr(trim((string) ($body['city'] ?? '')), 0, 80);
            $note = trim((string) ($body['note'] ?? ''));
            $days = $body['days'] ?? [];
            if (!is_array($days) || !$days) {
                fail('缺少行程内容');
            }
            $amapKey = (string) ($config['amap_key'] ?? '');
            $pdo->beginTransaction();
            try {
                $planId = gen_id('p_');
                $next = (int) $pdo->query('SELECT COALESCE(MAX(sort_order),0)+1 FROM trip_plans')->fetchColumn();
                $pdo->prepare('INSERT INTO trip_plans (id, title, cover_tone, plan_date, plan_date_end, cover_image_url, note, sort_order) VALUES (?,?,?,?,?,?,?,?)')
                    ->execute([$planId, $title, $tone, $planDate, null, '', $note, $next]);
                $stStop = $pdo->prepare('INSERT INTO plan_stops (plan_id, name, address, latitude, longitude, note, planned_time, day, sort_order) VALUES (?,?,?,?,?,?,?,?,?)');
                $sort = 0;
                $stopCount = 0;
                $geoStops = 0;
                foreach ($days as $d) {
                    $dayNum = max(1, min(60, (int) ($d['day'] ?? 1)));
                    $stops = isset($d['stops']) && is_array($d['stops']) ? $d['stops'] : [];
                    foreach ($stops as $s) {
                        $name = mb_substr(trim((string) ($s['name'] ?? '')), 0, 128);
                        if ($name === '') {
                            continue;
                        }
                        $stopNote = mb_substr(trim((string) ($s['desc'] ?? $s['note'] ?? '')), 0, 255);
                        $time = mb_substr(trim((string) ($s['time'] ?? $s['plannedTime'] ?? '')), 0, 32);
                        $rawAddress = mb_substr(trim((string) ($s['address'] ?? '')), 0, 255);
                        $address = $rawAddress;
                        $lat = null;
                        $lng = null;
                        if ($amapKey !== '') {
                            $query = $rawAddress !== '' ? $rawAddress : (($city !== '' ? $city . ' ' : '') . $name);
                            $geo = amap_lookup_place($amapKey, $query, $city);
                            if ($geo) {
                                $lat = round((float) $geo['latitude'], 6);
                                $lng = round((float) $geo['longitude'], 6);
                                $address = mb_substr(trim((string) ($geo['formatted'] ?? $rawAddress)), 0, 255);
                                if ($address === '') {
                                    $address = $rawAddress;
                                }
                                $geoStops++;
                            }
                        }
                        $stStop->execute([$planId, $name, $address, $lat, $lng, $stopNote, $time, $dayNum, $sort++]);
                        if (++$stopCount >= 80) {
                            break 2;
                        }
                    }
                }
                $pdo->commit();
            } catch (Throwable $e) {
                if ($pdo->inTransaction()) {
                    $pdo->rollBack();
                }
                fail('导入失败，请重试', 500);
            }
            out(['ok' => true, 'id' => $planId, 'stops' => $stopCount, 'geoStops' => $geoStops]);
        }

        /* ============ AI 批量打标：多张图片URL → 每张返回标签 ============ */
        case 'ai_tag': {
            if (empty($config['ai_enabled'])) { fail('功能未开放', 503); }
            $key = (string) ($config['deepseek_key'] ?? '');
            if ($key === '') { fail('功能暂未开放', 503); }
            $images = $body['images'] ?? [];
            if (!is_array($images) || !$images) { fail('缺少图片列表'); }
            $images = array_slice($images, 0, 20); // 限最多20张
            $list = [];
            foreach ($images as $img) {
                $url = trim((string) ($img['imageUrl'] ?? $img['url'] ?? ''));
                $city = trim((string) ($img['city'] ?? ''));
                if ($url === '') continue;
                $ctx = $city !== '' ? "，拍摄地{$city}" : '';
                $system = '你是旅行图片标签专家。根据图片URL和城市信息，推断标签。'
                    . '用JSON返回，键固定为：'
                    . 'tags（数组，2-4个场景/氛围标签，每个≤5字）、'
                    . 'mood（字符串：浪漫/治愈/冒险/文艺/温馨/活力）、'
                    . 'weather（字符串：晴/多云/阴/雨/雪）。只输出JSON。';
                $user = "图片{$ctx}：{$url}";
                $res = deepseek_json($key, $system, $user, 0.5, 200);
                $list[] = ['imageUrl' => $url, 'tags' => is_array($res['tags'] ?? null) ? $res['tags'] : []];
            }
            out(['ok' => true, 'results' => $list]);
        }

        /* ============ AI 精华筛选：从所有照片评出最佳时刻 + 最爱地点 ============ */
        case 'ai_highlights': {
            if (empty($config['ai_enabled'])) { fail('功能未开放', 503); }
            $key = (string) ($config['deepseek_key'] ?? '');
            if ($key === '') { fail('功能暂未开放', 503); }
            // 从数据库取所有照片（带城市/日期）
            $rows = $pdo->query(
                'SELECT p.id, p.image_url, p.title, j.city, j.travel_date, j.province
                 FROM journey_photos p
                 JOIN journeys j ON j.id = p.journey_id
                 WHERE p.image_url != "" AND p.image_url IS NOT NULL
                 ORDER BY j.travel_date DESC LIMIT 60'
            )->fetchAll();
            if (!$rows) { out(['ok' => true, 'topPhotos' => [], 'topPlaces' => []]); }
            // 构造简要列表给 AI 评分
            $brief = [];
            foreach ($rows as $i => $r) {
                $brief[] = "#{$i} city={$r['city']} date={$r['travel_date']} url={$r['image_url']}";
            }
            $system = '你是旅行摄影精选编辑。根据城市、日期、图片URL列表，选出最有可能是精华照片的5张（url越独特/城市越特别越优先），'
                . '以及出现次数最多或最有意义的3个地点。用JSON返回，键固定为 topPhotos（索引号数组，如[0,3,7]）和 topPlaces（城市名字符串数组）。只输出JSON。';
            $user = implode("\n", $brief);
            $data = deepseek_json($key, $system, $user, 0.4, 400);
            $idxs = is_array($data['topPhotos'] ?? null) ? $data['topPhotos'] : [];
            $topPhotos = [];
            foreach ($idxs as $i) {
                $r = $rows[(int)$i] ?? null;
                if ($r) $topPhotos[] = ['imageUrl' => $r['image_url'], 'city' => $r['city'], 'date' => $r['travel_date']];
            }
            $topPlaces = is_array($data['topPlaces'] ?? null) ? $data['topPlaces'] : [];
            out(['ok' => true, 'topPhotos' => $topPhotos, 'topPlaces' => $topPlaces]);
        }

        /* ============ 随手记 CRUD ============ */
        case 'add_moment': {
            $imageUrl = trim((string) ($body['imageUrl'] ?? ''));
            if ($imageUrl === '') { fail('缺少图片'); }
            $caption = trim((string) ($body['caption'] ?? ''));
            $tags = is_array($body['tags'] ?? null) ? $body['tags'] : [];
            $journeyId = trim((string) ($body['journeyId'] ?? '')) ?: null;
            $id = gen_id('m_');
            $pdo->prepare(
                'INSERT INTO moments (id, openid, image_url, caption, tags, journey_id) VALUES (?,?,?,?,?,?)'
            )->execute([$id, $openid, $imageUrl, $caption, json_encode($tags, JSON_UNESCAPED_UNICODE), $journeyId]);
            out(['ok' => true, 'id' => $id]);
        }

        case 'list_moments': {
            $limit = min(50, max(1, (int) ($body['limit'] ?? 20)));
            $before = trim((string) ($body['before'] ?? ''));
            $sql = 'SELECT id, image_url, caption, tags, journey_id, created_at FROM moments';
            $args = [];
            if ($before !== '') { $sql .= ' WHERE created_at < ?'; $args[] = $before; }
            $sql .= ' ORDER BY created_at DESC LIMIT ?';
            $args[] = $limit;
            $st = $pdo->prepare($sql); $st->execute($args);
            $list = array_map(static fn($r) => [
                'id' => $r['id'],
                'imageUrl' => $r['image_url'],
                'caption' => $r['caption'],
                'tags' => json_decode($r['tags'] ?: '[]', true),
                'journeyId' => $r['journey_id'],
                'createdAt' => $r['created_at'],
            ], $st->fetchAll());
            out(['ok' => true, 'moments' => $list]);
        }

        case 'del_moment': {
            $id = (string) ($body['id'] ?? '');
            if ($id === '') { fail('缺少 id'); }
            $pdo->prepare('DELETE FROM moments WHERE id = ?')->execute([$id]);
            out(['ok' => true]);
        }


        /* ============ 前端读取功能开关 ============ */
        case 'get_config': {
            out(['aiEnabled' => !empty($config['ai_enabled'])]);
        }

        /* ============ AI 预算分析：按花费分类给出建议 ============ */
        case 'ai_budget_analysis': {
            if (empty($config['ai_enabled'])) { fail('功能未开放', 503); }
            $key = (string) ($config['deepseek_key'] ?? '');
            if ($key === '') { fail('未配置 DeepSeek key', 503); }
            $planId = trim((string) ($body['planId'] ?? ''));
            $city = trim((string) ($body['city'] ?? ''));
            $total = (float) ($body['total'] ?? 0);
            $byCategory = $body['byCategory'] ?? [];
            if ($total <= 0) { fail('暂无花费数据'); }
            $cats = ['food'=>'餐饮','transport'=>'交通','hotel'=>'住宿','ticket'=>'门票','shopping'=>'购物','other'=>'其他'];
            $breakdown = '';
            foreach ((array)$byCategory as $k => $v) {
                $label = $cats[$k] ?? $k;
                $pct = $total > 0 ? round((float)$v / $total * 100) : 0;
                $breakdown .= "  {$label}：¥{$v}（{$pct}%）\n";
            }
            $system = '你是一个贴心的旅行记账分析师，服务对象是情侣。根据花费明细，给出2-3句温暖又实用的消费总结和建议，不要说废话。控制在100字内。';
            $user = ($city ? "{$city}旅行" : '这次旅行') . "，总花费 ¥{$total}，明细：\n{$breakdown}";
            $text = deepseek_chat($key, $system, $user, 0.7);
            if (!$text) { fail('暂时无法分析，请稍后再试', 502); }
            out(['ok' => true, 'analysis' => $text]);
        }

        /* ============ AI 旅行故事生成器 ============ */
        case 'ai_story': {
            if (empty($config['ai_enabled'])) { fail('功能未开放', 503); }
            $key = (string) ($config['deepseek_key'] ?? '');
            if ($key === '') { fail('未配置 DeepSeek key', 503); }
            $year = trim((string) ($body['year'] ?? ''));
            $sql = 'SELECT j.city, j.province, j.travel_date, j.title, j.intro, j.season, j.weather, j.landmark,
                    GROUP_CONCAT(DISTINCT jt.name ORDER BY jt.sort_order SEPARATOR "、") as tags,
                    COUNT(DISTINCT jp.id) as photo_count,
                    GROUP_CONCAT(DISTINCT jn.content ORDER BY jn.sort_order SEPARATOR "\n") as notes
                    FROM journeys j
                    LEFT JOIN journey_tags jt ON jt.journey_id = j.id
                    LEFT JOIN journey_photos jp ON jp.journey_id = j.id
                    LEFT JOIN journey_notes jn ON jn.journey_id = j.id';
            $args = [];
            if ($year !== '') { $sql .= ' WHERE YEAR(j.travel_date) = ?'; $args[] = (int)$year; }
            $sql .= ' GROUP BY j.id ORDER BY j.travel_date ASC LIMIT 30';
            $st = $pdo->prepare($sql); $st->execute($args);
            $rows = $st->fetchAll();
            if (!$rows) { fail('还没有足迹数据'); }
            $summary = '';
            foreach ($rows as $r) {
                $summary .= "- {$r['travel_date']} {$r['city']}（{$r['province']}）";
                if ($r['title']) $summary .= " 「{$r['title']}」";
                if ($r['landmark']) $summary .= " 地标：{$r['landmark']}";
                if ($r['tags']) $summary .= " 标签：{$r['tags']}";
                if ($r['notes']) $summary .= " 手记：" . mb_substr($r['notes'], 0, 60);
                $summary .= " 照片{$r['photo_count']}张\n";
            }
            $system = '你是一位擅长写情感故事的作家。根据情侣的旅行足迹数据，用温柔、有诗意的第一人称写一篇旅行回忆故事（400-600字）。' .
                '要有情感，有细节，有画面感，像一封写给未来的信。分3-4段，每段有小标题（用「」括起来）。';
            $scope = $year ? "{$year}年" : '所有年份';
            $user = "这是我们{$scope}的旅行足迹：\n{$summary}\n请写一篇旅行故事。";
            $text = deepseek_chat($key, $system, $user, 0.9);
            if (!$text) { fail('AI 暂时不可用', 502); }
            out(['ok' => true, 'story' => $text, 'year' => $year, 'count' => count($rows)]);
        }

        /* ============ 时间胶囊 ============ */
        case 'add_capsule': {
            $title = mb_substr(trim((string)($body['title'] ?? '')), 0, 128);
            $message = trim((string)($body['message'] ?? ''));
            $openDate = trim((string)($body['openDate'] ?? ''));
            $photos = is_array($body['photos'] ?? null) ? $body['photos'] : [];
            if ($title === '' || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $openDate)) { fail('标题和开启日期必填'); }
            if ($openDate <= date('Y-m-d')) { fail('开启日期必须是未来'); }
            $id = gen_id('cap_');
            $pdo->prepare('INSERT INTO time_capsules (id, openid, open_date, title, message, photo_urls) VALUES (?,?,?,?,?,?)')
                ->execute([$id, $openid, $openDate, $title, $message, json_encode($photos, JSON_UNESCAPED_UNICODE)]);
            out(['ok' => true, 'id' => $id]);
        }

        case 'list_capsules': {
            $rows = $pdo->query('SELECT id, open_date, title, message, photo_urls, is_opened, created_at FROM time_capsules ORDER BY open_date ASC, created_at DESC')->fetchAll();
            $today = date('Y-m-d');
            $list = array_map(static fn($r) => [
                'id' => $r['id'],
                'openDate' => $r['open_date'],
                'title' => $r['title'],
                'canOpen' => $r['open_date'] <= $today,
                'isOpened' => (int)$r['is_opened'] === 1,
                'message' => (int)$r['is_opened'] === 1 || $r['open_date'] <= $today ? $r['message'] : '',
                'photos' => (int)$r['is_opened'] === 1 || $r['open_date'] <= $today ? json_decode($r['photo_urls'] ?: '[]', true) : [],
                'createdAt' => $r['created_at'],
            ], $rows);
            out(['ok' => true, 'capsules' => $list]);
        }

        case 'open_capsule': {
            $id = (string)($body['id'] ?? '');
            if ($id === '') { fail('缺少 id'); }
            $row = $pdo->prepare('SELECT open_date, message, photo_urls FROM time_capsules WHERE id = ?');
            $row->execute([$id]);
            $r = $row->fetch();
            if (!$r) { fail('不存在'); }
            if ($r['open_date'] > date('Y-m-d')) { fail('还没到开启时间'); }
            $pdo->prepare('UPDATE time_capsules SET is_opened = 1 WHERE id = ?')->execute([$id]);
            out(['ok' => true, 'message' => $r['message'], 'photos' => json_decode($r['photo_urls'] ?: '[]', true)]);
        }

        /* ============ 情侣打卡记录 CRUD ============ */
        case 'add_log': {
            $category = trim((string)($body['category'] ?? 'other'));
            $title = mb_substr(trim((string)($body['title'] ?? '')), 0, 256);
            $date = trim((string)($body['date'] ?? date('Y-m-d')));
            if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) { $date = date('Y-m-d'); }
            $note = trim((string)($body['note'] ?? ''));
            $coverImage = mb_substr(trim((string)($body['coverImage'] ?? '')), 0, 512);
            $rating = max(0, min(5, (int)($body['rating'] ?? 0)));
            if ($title === '') { fail('标题不能为空'); }
            $id = gen_id('log_');
            $pdo->prepare('INSERT INTO couple_logs (id, openid, category, title, log_date, note, cover_image, rating) VALUES (?,?,?,?,?,?,?,?)')
                ->execute([$id, $openid, $category, $title, $date, $note, $coverImage, $rating]);
            out(['ok' => true, 'id' => $id]);
        }

        case 'list_logs': {
            $category = trim((string)($body['category'] ?? ''));
            $sql = 'SELECT id, category, title, log_date, note, cover_image, rating, created_at FROM couple_logs';
            $args = [];
            if ($category !== '' && $category !== 'all') { $sql .= ' WHERE category = ?'; $args[] = $category; }
            $sql .= ' ORDER BY log_date DESC, created_at DESC LIMIT 100';
            $st = $pdo->prepare($sql); $st->execute($args);
            $list = array_map(static fn($r) => [
                'id' => $r['id'],
                'category' => $r['category'],
                'title' => $r['title'],
                'date' => $r['log_date'],
                'note' => $r['note'],
                'coverImage' => $r['cover_image'],
                'rating' => (int)$r['rating'],
            ], $st->fetchAll());
            // 各分类计数
            $counts = $pdo->query('SELECT category, COUNT(*) as cnt FROM couple_logs GROUP BY category')->fetchAll();
            $countMap = [];
            foreach ($counts as $c) { $countMap[$c['category']] = (int)$c['cnt']; }
            out(['ok' => true, 'logs' => $list, 'counts' => $countMap]);
        }

        case 'del_log': {
            $id = (string)($body['id'] ?? '');
            if ($id === '') { fail('缺少 id'); }
            $pdo->prepare('DELETE FROM couple_logs WHERE id = ?')->execute([$id]);
            out(['ok' => true]);
        }

        /* ============ AI 推荐下一个目的地 ============ */
        case 'ai_next_dest': {
            if (empty($config['ai_enabled'])) { fail('功能未开放', 503); }
            $key = (string) ($config['deepseek_key'] ?? '');
            if ($key === '') { fail('未配置 DeepSeek key', 503); }
            // 取已去过的城市和省份
            $rows = $pdo->query(
                'SELECT DISTINCT city, province, season FROM journeys WHERE city != "" ORDER BY travel_date DESC LIMIT 20'
            )->fetchAll();
            if (!$rows) { fail('还没有足迹数据'); }
            $visited = implode('、', array_map(fn($r) => $r['city'], $rows));
            $provinces = implode('、', array_unique(array_filter(array_map(fn($r) => $r['province'], $rows))));
            $seasons = array_count_values(array_filter(array_map(fn($r) => $r['season'], $rows)));
            arsort($seasons);
            $favSeason = array_key_first($seasons) ?? '';
            $system = '你是一位专业旅行顾问，为情侣推荐下一个旅行目的地。'
                . '根据已去过的城市分析他们的旅行偏好，推荐3个最适合的下一个目的地。'
                . '用JSON返回，键固定为 destinations（数组，每个含 city、reason（50字内）、bestTime（季节）、highlight（一个必去景点）、tags（数组，2-3个标签））。只输出JSON。';
            $user = "已去过：{$visited}。去过的省份：{$provinces}。偏好季节：{$favSeason}。请推荐3个下一站。";
            $data = deepseek_json($key, $system, $user, 0.8, 800);
            if (!is_array($data) || empty($data['destinations'])) { fail('AI 暂时不可用', 502); }
            out(['ok' => true, 'destinations' => $data['destinations']]);
        }

        /* ============ AI 每日旅行灵感 ============ */
        case 'ai_daily_inspiration': {
            if (empty($config['ai_enabled'])) { out(['ok' => true, 'quote' => '']); }
            $key = (string) ($config['deepseek_key'] ?? '');
            if ($key === '') { out(['ok' => true, 'quote' => '']); }
            // 取一段随机足迹作为灵感来源
            $row = $pdo->query(
                'SELECT city, province, travel_date, title, intro FROM journeys ORDER BY RAND() LIMIT 1'
            )->fetch();
            if (!$row) { out(['ok' => true, 'quote' => '']); }
            $ctx = "{$row['city']}，{$row['travel_date']}";
            if ($row['title']) $ctx .= "，「{$row['title']}」";
            $system = '你是一位旅行诗人。根据一段旅行信息，写一句温柔有诗意的旅行感悟或金句（25字以内），不要说废话，不要解释，直接输出那句话。';
            $user = "灵感来源：{$ctx}";
            $text = deepseek_chat($key, $system, $user, 0.95);
            out(['ok' => true, 'quote' => $text ?: '']);
        }

        /* ============ 两人足迹对比 ============ */
        case 'journey_compare': {
            // 取所有足迹，按 openid 分组
            $rows = $pdo->query(
                'SELECT id, city, province, travel_date, openid, title
                 FROM journeys WHERE openid != "" ORDER BY travel_date DESC'
            )->fetchAll();
            // 统计每个城市的打卡 openid
            $cityOpenids = [];
            foreach ($rows as $r) {
                $city = $r['city'];
                if (!isset($cityOpenids[$city])) $cityOpenids[$city] = [];
                $cityOpenids[$city][$r['openid']] = true;
            }
            // 取所有不同的 openid
            $allOpenids = array_unique(array_column($rows, 'openid'));
            if (count($allOpenids) < 2) {
                // 只有一个人的数据，返回全部作为「我的足迹」
                out(['ok' => true, 'together' => [], 'mine' => array_keys($cityOpenids), 'hers' => [], 'singleUser' => true]);
            }
            $oid1 = $allOpenids[0];
            $oid2 = $allOpenids[1];
            $together = [];
            $mine = [];
            $hers = [];
            foreach ($cityOpenids as $city => $oids) {
                $has1 = isset($oids[$oid1]);
                $has2 = isset($oids[$oid2]);
                if ($has1 && $has2) $together[] = $city;
                elseif ($has1) $mine[] = $city;
                elseif ($has2) $hers[] = $city;
            }
            out(['ok' => true, 'together' => $together, 'mine' => $mine, 'hers' => $hers, 'singleUser' => false, 'total' => count($cityOpenids)]);
        }

        default:
            fail('unknown action: ' . $action);
    }
} catch (Throwable $e) {
    out(['error' => 'server_error', 'message' => 'admin failed'], 500);
}
