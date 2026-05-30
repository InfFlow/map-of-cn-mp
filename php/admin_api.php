<?php
declare(strict_types=1);

/**
 * Map of Us · 小程序内管理接口
 * 管理员（owner）在小程序里维护：分类（增/改/排序/显隐/删）、菜品（增改/传图/上下架/删）、订单（列表/改状态）。
 * 鉴权：用 openid 标记 app_users.is_admin；首次用后台口令认领（claim_admin）。
 * 与 menu.php / auth.php / order.php 共用 _private/db.php、_private/config.php。
 */

require_once dirname(__DIR__) . '_private/db.php';

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

/** 调用 DeepSeek chat 接口，返回助手文本（失败返回 null） */
function deepseek_chat(string $key, string $system, string $user, float $temperature = 0.8): ?string
{
    if ($key === '') {
        return null;
    }
    $payload = json_encode([
        'model' => 'deepseek-chat',
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

try {
    $pdo = db();
    $config = require dirname(__DIR__) . '_private/config.php';

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

    /* 情侣共编：足迹/纪念日/行程 + 心愿单 + 记账 + 菜品/分类/订单 + 图片上传，任意已登录用户可增删改 */
    $coupleEditable = [
        'admin_journeys', 'add_journey', 'update_journey', 'del_journey', 'toggle_journey', 'reorder_journeys',
        'admin_anniversaries', 'add_anniversary', 'update_anniversary', 'del_anniversary', 'reorder_anniversaries',
        'admin_plans', 'add_plan', 'update_plan', 'del_plan', 'toggle_plan', 'reorder_plans',
        'add_stop', 'update_stop', 'del_stop', 'reorder_stops',
        'wishes', 'add_wish', 'update_wish', 'del_wish', 'toggle_wish',
        'expenses', 'add_expense', 'del_expense',
        'add_journey_photo', 'del_journey_photo',
        'geo', 'ai_recommend', 'upload_image',
        /* 菜单后台：菜品 / 分类 / 订单 —— 情侣双方都可编辑 */
        'overview', 'orders', 'set_order_status',
        'add_category', 'update_category', 'toggle_category', 'del_category', 'reorder_categories',
        'add_dish', 'update_dish', 'toggle_dish', 'del_dish', 'reorder_dishes',
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
                'SELECT id, city, province, travel_date, season, weather, landmark,
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
                    'INSERT INTO journeys (id, city, province, travel_date, season, weather, landmark, latitude, longitude, cover_tone, title, intro, sort_order, is_visible)
                     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1)'
                )->execute([$id, $city, $province, $date, $season, $weather, $landmark, $lat, $lng, $tone, $title, $intro, $next]);
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
                'SELECT id, title, cover_tone, plan_date, plan_date_end, cover_image_url, note, sort_order, is_visible
                 FROM trip_plans ORDER BY sort_order ASC, created_at DESC, id ASC'
            )->fetchAll();
            $ids = array_column($plans, 'id');
            $stopsBy = [];
            if ($ids) {
                $ph = implode(',', array_fill(0, count($ids), '?'));
                $ss = $pdo->prepare(
                    "SELECT id, plan_id, name, address, latitude, longitude, note, planned_time, day, sort_order
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
                        'plannedTime' => $s['planned_time'],
                        'day' => (int) ($s['day'] ?? 1),
                        'sortOrder' => (int) $s['sort_order'],
                    ];
                }
            }
            $list = array_map(static fn ($p) => [
                'id' => $p['id'],
                'title' => $p['title'],
                'coverTone' => $p['cover_tone'],
                'planDate' => $p['plan_date'],
                'planDateEnd' => $p['plan_date_end'],
                'coverImageUrl' => $p['cover_image_url'],
                'note' => $p['note'],
                'sortOrder' => (int) $p['sort_order'],
                'visible' => (int) $p['is_visible'] === 1,
                'stops' => $stopsBy[$p['id']] ?? [],
            ], $plans);
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
            if ($action === 'add_plan') {
                $id = gen_id('p_');
                $next = (int) $pdo->query('SELECT COALESCE(MAX(sort_order),0)+1 FROM trip_plans')->fetchColumn();
                $pdo->prepare('INSERT INTO trip_plans (id, title, cover_tone, plan_date, plan_date_end, cover_image_url, note, sort_order) VALUES (?,?,?,?,?,?,?,?)')
                    ->execute([$id, $title, $tone, $planDate, $planDateEnd, $coverImage, $note, $next]);
                out(['ok' => true, 'id' => $id]);
            }
            $id = (string) ($body['id'] ?? '');
            if ($id === '') {
                fail('缺少 id');
            }
            $pdo->prepare('UPDATE trip_plans SET title=?, cover_tone=?, plan_date=?, plan_date_end=?, cover_image_url=?, note=? WHERE id=?')
                ->execute([$title, $tone, $planDate, $planDateEnd, $coverImage, $note, $id]);
            out(['ok' => true]);
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
            $plannedTime = mb_substr(trim((string) ($body['plannedTime'] ?? '')), 0, 32);
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
                $pdo->prepare('INSERT INTO plan_stops (plan_id, name, address, latitude, longitude, note, planned_time, day, sort_order) VALUES (?,?,?,?,?,?,?,?,?)')
                    ->execute([$planId, $name, $address, $lat, $lng, $note, $plannedTime, $day, $order]);
                out(['ok' => true, 'id' => (int) $pdo->lastInsertId()]);
            }
            $id = (int) ($body['id'] ?? 0);
            if ($id <= 0) {
                fail('缺少 id');
            }
            $pdo->prepare('UPDATE plan_stops SET name=?, address=?, latitude=?, longitude=?, note=?, planned_time=?, day=? WHERE id=?')
                ->execute([$name, $address, $lat, $lng, $note, $plannedTime, $day, $id]);
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
            // 先用 POI 关键字搜索（景区/地标名更准），失败再退回结构化地理编码
            $poi = amap_get('place/text', ['keywords' => $address, 'city' => $city, 'offset' => 1, 'page' => 1], $key);
            if ($poi && ($poi['status'] ?? '0') === '1' && !empty($poi['pois'][0]['location'])) {
                $p = $poi['pois'][0];
                [$lng, $lat] = array_map('floatval', explode(',', (string) $p['location']));
                out([
                    'ok' => true,
                    'longitude' => $lng,
                    'latitude' => $lat,
                    'province' => is_string($p['pname'] ?? '') ? $p['pname'] : '',
                    'city' => is_string($p['cityname'] ?? '') ? $p['cityname'] : '',
                    'formatted' => (string) ($p['name'] ?? $address),
                ]);
            }
            $res = amap_get('geocode/geo', ['address' => $address, 'city' => $city], $key);
            if (!$res || ($res['status'] ?? '0') !== '1' || empty($res['geocodes'])) {
                fail('未找到该地点', 404);
            }
            $g = $res['geocodes'][0];
            [$lng, $lat] = array_map('floatval', explode(',', (string) ($g['location'] ?? '0,0')));
            out([
                'ok' => true,
                'longitude' => $lng,
                'latitude' => $lat,
                'province' => $g['province'] ?? '',
                'city' => is_string($g['city'] ?? '') ? $g['city'] : '',
                'formatted' => $g['formatted_address'] ?? $address,
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
                'SELECT id, place_name, province, city, latitude, longitude, memo, done, sort_order
                 FROM desire_list ORDER BY done ASC, sort_order ASC, created_at DESC'
            )->fetchAll();
            $list = array_map(static fn ($r) => [
                'id' => $r['id'],
                'placeName' => $r['place_name'],
                'province' => $r['province'],
                'city' => $r['city'],
                'latitude' => $r['latitude'] !== null ? (float) $r['latitude'] : null,
                'longitude' => $r['longitude'] !== null ? (float) $r['longitude'] : null,
                'memo' => $r['memo'],
                'done' => (int) $r['done'] === 1,
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
            $pdo->prepare('UPDATE desire_list SET done = 1 - done WHERE id = ?')->execute([$id]);
            out(['ok' => true]);
        }

        case 'del_wish': {
            $id = (string) ($body['id'] ?? '');
            $pdo->prepare('DELETE FROM desire_list WHERE id = ?')->execute([$id]);
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

        default:
            fail('unknown action: ' . $action);
    }
} catch (Throwable $e) {
    out(['error' => 'server_error', 'message' => 'admin failed'], 500);
}
