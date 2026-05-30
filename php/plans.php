<?php
declare(strict_types=1);

/**
 * Map of Us · 旅行计划（行程）公开读取接口
 * 返回所有可见的计划及其目的地（按排序）。任何登录用户都可查看；编辑在 admin_api.php。
 */

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

    $plans = $pdo->query(
        'SELECT id, title, cover_tone, plan_date, note, sort_order
         FROM trip_plans WHERE is_visible = 1
         ORDER BY sort_order ASC, created_at DESC, id ASC'
    )->fetchAll();

    $ids = array_column($plans, 'id');
    $stopsBy = [];
    if ($ids) {
        $ph = implode(',', array_fill(0, count($ids), '?'));
        $ss = $pdo->prepare(
            "SELECT id, plan_id, name, address, latitude, longitude, note, planned_time, sort_order
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
            ];
        }
    }

    $list = array_map(static function (array $p) use ($stopsBy): array {
        return [
            'id' => $p['id'],
            'title' => $p['title'],
            'coverTone' => $p['cover_tone'],
            'planDate' => $p['plan_date'] ? date('Y.m.d', strtotime((string) $p['plan_date'])) : null,
            'note' => $p['note'],
            'stops' => $stopsBy[$p['id']] ?? [],
        ];
    }, $plans);

    echo json_encode(['plans' => $list], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
} catch (Throwable $error) {
    http_response_code(500);
    echo json_encode(['error' => 'server_error', 'message' => 'Failed to load plans'], JSON_UNESCAPED_UNICODE);
}
