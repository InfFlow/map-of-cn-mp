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

// 每个环最多保留的点数，等距抽稀，避免 map 组件渲染过重
const MAX_POINTS_PER_RING = 160;

function downsample(array $ring): array
{
    $n = count($ring);
    if ($n <= MAX_POINTS_PER_RING) {
        return $ring;
    }
    $step = (int) ceil($n / MAX_POINTS_PER_RING);
    $out = [];
    for ($i = 0; $i < $n; $i += $step) {
        $out[] = $ring[$i];
    }
    // 保证闭合：补上最后一个点
    $last = $ring[$n - 1];
    $tail = end($out);
    if ($tail['latitude'] !== $last['latitude'] || $tail['longitude'] !== $last['longitude']) {
        $out[] = $last;
    }
    return $out;
}

function ringToPoints(array $ring): array
{
    $points = [];
    foreach ($ring as $coord) {
        // GeoJSON 顺序为 [lng, lat]
        $points[] = ['latitude' => (float) $coord[1], 'longitude' => (float) $coord[0]];
    }
    return downsample($points);
}

try {
    $pdo = db();
    $rows = $pdo->query('SELECT DISTINCT province FROM journeys WHERE is_visible = 1')->fetchAll();
    $names = array_values(array_filter(array_map(static fn($r) => (string) $r['province'], $rows)));

    $geoPath = dirname(__DIR__) . '_private/china-provinces.json';
    $geo = json_decode((string) file_get_contents($geoPath), true);

    $result = [];
    foreach ($geo['features'] as $feature) {
        $fullName = $feature['properties']['name'] ?? '';
        if ($fullName === '') {
            continue;
        }
        // 数据库里省名可能不带「省/市/自治区」后缀，用前缀匹配
        $matched = null;
        foreach ($names as $short) {
            if (mb_strpos($fullName, $short) === 0 || mb_strpos($short, $fullName) === 0) {
                $matched = $short;
                break;
            }
        }
        if ($matched === null) {
            continue;
        }

        $geom = $feature['geometry'] ?? null;
        if (!$geom) {
            continue;
        }
        $rings = [];
        if ($geom['type'] === 'Polygon') {
            $rings[] = $geom['coordinates'][0];
        } elseif ($geom['type'] === 'MultiPolygon') {
            foreach ($geom['coordinates'] as $poly) {
                $rings[] = $poly[0];
            }
        }
        foreach ($rings as $ring) {
            // 跳过细小岛屿/碎块，只保留较完整的轮廓
            if (count($ring) < 40) {
                continue;
            }
            $points = ringToPoints($ring);
            if (count($points) > 2) {
                $result[] = ['province' => $matched, 'points' => $points];
            }
        }
    }

    echo json_encode($result, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
} catch (Throwable $error) {
    http_response_code(500);
    echo json_encode([
        'error' => 'server_error',
        'message' => 'Failed to load provinces',
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
}
