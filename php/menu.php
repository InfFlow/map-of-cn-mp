<?php
declare(strict_types=1);

require_once dirname(__DIR__) . '_private/db.php';

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

try {
    $pdo = db();

    $cats = $pdo->query(
        'SELECT id, name FROM dish_categories
         WHERE is_visible = 1
         ORDER BY sort_order ASC, id ASC'
    )->fetchAll();

    $dishRows = $pdo->query(
        'SELECT id, category_id, name, description, price, image_url,
                is_recommended, spicy_level, portion
         FROM dishes
         WHERE is_available = 1
         ORDER BY sort_order ASC, id ASC'
    )->fetchAll();

    $byCat = [];
    foreach ($dishRows as $d) {
        $byCat[(int) $d['category_id']][] = [
            'id' => (int) $d['id'],
            'name' => $d['name'],
            'description' => $d['description'],
            'price' => (float) $d['price'],
            'imageUrl' => $d['image_url'],
            'recommended' => (int) ($d['is_recommended'] ?? 0) === 1,
            'spicy' => (int) ($d['spicy_level'] ?? 0),
            'portion' => $d['portion'] ?? '',
        ];
    }

    $categories = [];
    foreach ($cats as $c) {
        $cid = (int) $c['id'];
        $categories[] = [
            'id' => $cid,
            'name' => $c['name'],
            'dishes' => $byCat[$cid] ?? [],
        ];
    }

    echo json_encode(['categories' => $categories], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['error' => 'server_error', 'message' => 'Failed to load menu'], JSON_UNESCAPED_UNICODE);
}
