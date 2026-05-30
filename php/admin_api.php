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

    /* 其余动作都需要管理员 */
    if (!is_admin_openid($pdo, $openid)) {
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

        default:
            fail('unknown action: ' . $action);
    }
} catch (Throwable $e) {
    out(['error' => 'server_error', 'message' => 'admin failed'], 500);
}
