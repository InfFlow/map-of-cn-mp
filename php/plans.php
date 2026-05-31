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

/**
 * 把一行 trip_plans 记录里的住宿/出发点字段解析成结构化输出。
 * 返回 ['hotel' => {name,address,lat,lng}|null, 'dayStarts' => { "1": {name,address,lat,lng}, ... }]
 */
function plan_places(array $p): array
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
    return ['hotel' => $hotel, 'dayStarts' => (object) $dayStarts];
}

try {
    $pdo = db();

    $plans = $pdo->query(
        'SELECT id, title, cover_tone, plan_date, plan_date_end, cover_image_url, note,
                hotel_name, hotel_address, hotel_lat, hotel_lng, day_starts, sort_order
         FROM trip_plans WHERE is_visible = 1
         ORDER BY sort_order ASC, created_at DESC, id ASC'
    )->fetchAll();

    $ids = array_column($plans, 'id');
    $stopsBy = [];
    if ($ids) {
        $ph = implode(',', array_fill(0, count($ids), '?'));
        $ss = $pdo->prepare(
            "SELECT id, plan_id, name, address, latitude, longitude, note, open_hours, ticket, booking_url, planned_time, day, sort_order
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
                'day' => (int) ($s['day'] ?? 1),
            ];
        }
    }

    $list = array_map(static function (array $p) use ($stopsBy): array {
        $places = plan_places($p);
        return [
            'id' => $p['id'],
            'title' => $p['title'],
            'coverTone' => $p['cover_tone'],
            'planDate' => $p['plan_date'] ? date('Y.m.d', strtotime((string) $p['plan_date'])) : null,
            'planDateEnd' => $p['plan_date_end'] ? date('Y.m.d', strtotime((string) $p['plan_date_end'])) : null,
            'coverImageUrl' => $p['cover_image_url'] ?: null,
            'note' => $p['note'],
            'hotel' => $places['hotel'],
            'dayStarts' => $places['dayStarts'],
            'stops' => $stopsBy[$p['id']] ?? [],
        ];
    }, $plans);

    echo json_encode(['plans' => $list], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
} catch (Throwable $error) {
    http_response_code(500);
    echo json_encode(['error' => 'server_error', 'message' => 'Failed to load plans'], JSON_UNESCAPED_UNICODE);
}
