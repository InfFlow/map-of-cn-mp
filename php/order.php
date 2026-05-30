<?php
declare(strict_types=1);

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

try {
    $pdo = db();

    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        // 我的订单：?openid=xxx
        $openid = isset($_GET['openid']) ? trim((string) $_GET['openid']) : '';
        if ($openid === '') {
            out(['orders' => []]);
        }
        $stmt = $pdo->prepare(
            'SELECT id, remark, item_count, total_amount, status, created_at
             FROM orders WHERE user_openid = ?
             ORDER BY created_at DESC, id DESC LIMIT 50'
        );
        $stmt->execute([$openid]);
        $orders = $stmt->fetchAll();

        $ids = array_column($orders, 'id');
        $itemsByOrder = [];
        if ($ids) {
            $ph = implode(',', array_fill(0, count($ids), '?'));
            $is = $pdo->prepare(
                "SELECT order_id, dish_name, price, qty, remark
                 FROM order_items WHERE order_id IN ($ph) ORDER BY id ASC"
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

        $result = array_map(static function (array $o) use ($itemsByOrder): array {
            return [
                'id' => $o['id'],
                'remark' => $o['remark'],
                'itemCount' => (int) $o['item_count'],
                'totalAmount' => (float) $o['total_amount'],
                'status' => $o['status'],
                'createdAt' => $o['created_at'],
                'items' => $itemsByOrder[$o['id']] ?? [],
            ];
        }, $orders);

        out(['orders' => $result]);
    }

    // POST：创建订单
    $body = json_decode((string) file_get_contents('php://input'), true) ?: [];
    $openid = isset($body['openid']) ? trim((string) $body['openid']) : '';
    $nickname = isset($body['nickname']) ? mb_substr(trim((string) $body['nickname']), 0, 64) : '';
    $remark = isset($body['remark']) ? mb_substr(trim((string) $body['remark']), 0, 512) : '';
    $items = isset($body['items']) && is_array($body['items']) ? $body['items'] : [];

    if (!$items) {
        out(['error' => 'empty_order', 'message' => '请先选择菜品'], 400);
    }

    // 用提交的 dish_id 反查菜品，价格/菜名以服务端为准（防篡改）
    $dishIds = [];
    foreach ($items as $it) {
        $did = (int) ($it['id'] ?? 0);
        if ($did > 0) {
            $dishIds[$did] = true;
        }
    }
    $dishMap = [];
    if ($dishIds) {
        $ids = array_keys($dishIds);
        $ph = implode(',', array_fill(0, count($ids), '?'));
        $ds = $pdo->prepare("SELECT id, name, price FROM dishes WHERE id IN ($ph)");
        $ds->execute($ids);
        foreach ($ds->fetchAll() as $d) {
            $dishMap[(int) $d['id']] = $d;
        }
    }

    $orderId = date('ymdHis') . substr((string) mt_rand(1000, 9999), 0, 4);
    $itemCount = 0;
    $total = 0.0;
    $clean = [];
    foreach ($items as $it) {
        $did = (int) ($it['id'] ?? 0);
        if (!isset($dishMap[$did])) {
            continue;
        }
        $qty = max(1, min(99, (int) ($it['qty'] ?? 1)));
        $name = $dishMap[$did]['name'];
        $price = (float) $dishMap[$did]['price'];
        $iremark = isset($it['remark']) ? mb_substr(trim((string) $it['remark']), 0, 255) : '';
        $itemCount += $qty;
        $total += $price * $qty;
        $clean[] = [$did, $name, $price, $qty, $iremark];
    }

    if (!$clean) {
        out(['error' => 'invalid_items', 'message' => '菜品已下架或不存在'], 400);
    }

    $pdo->beginTransaction();
    $oi = $pdo->prepare(
        'INSERT INTO orders (id, user_openid, nickname, remark, item_count, total_amount, status)
         VALUES (?, ?, ?, ?, ?, ?, \'pending\')'
    );
    $oi->execute([$orderId, $openid, $nickname, $remark, $itemCount, $total]);

    $ii = $pdo->prepare(
        'INSERT INTO order_items (order_id, dish_id, dish_name, price, qty, remark)
         VALUES (?, ?, ?, ?, ?, ?)'
    );
    foreach ($clean as $c) {
        $ii->execute([$orderId, $c[0], $c[1], $c[2], $c[3], $c[4]]);
    }
    $pdo->commit();

    out([
        'id' => $orderId,
        'itemCount' => $itemCount,
        'totalAmount' => $total,
        'status' => 'pending',
    ]);
} catch (Throwable $e) {
    if (isset($pdo) && $pdo->inTransaction()) {
        $pdo->rollBack();
    }
    out(['error' => 'server_error', 'message' => 'order failed'], 500);
}
