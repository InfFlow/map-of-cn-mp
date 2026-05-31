<?php
declare(strict_types=1);

/**
 * Map of Us · 高德路线规划代理
 * 入参（GET 或 JSON POST）：
 *   origin       "lng,lat"   起点
 *   destination  "lng,lat"   终点
 *   city         起点城市（公交规划需要，城市名或 adcode）
 *   cityd        终点城市（跨城公交，可选）
 * 一次返回 步行 / 公交地铁 / 驾车 三种方案摘要 + 推荐方式 + 公交换乘步骤。
 * 高德 key 留在服务器（_private/config.php 的 amap_key），不下发到小程序。
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

function r_out($data, int $code = 200): void
{
    http_response_code($code);
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

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

function valid_lnglat(string $s): bool
{
    return (bool) preg_match('/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/', $s);
}

try {
    $config = require dirname(__DIR__) . '_private/config.php';
    $key = (string) ($config['amap_key'] ?? '');

    $body = $_SERVER['REQUEST_METHOD'] === 'POST'
        ? (json_decode((string) file_get_contents('php://input'), true) ?: $_POST)
        : $_GET;

    $origin = trim((string) ($body['origin'] ?? ''));
    $destination = trim((string) ($body['destination'] ?? ''));
    $city = trim((string) ($body['city'] ?? ''));
    $cityd = trim((string) ($body['cityd'] ?? $city));

    if ($key === '') {
        r_out(['error' => 'amap_unconfigured', 'message' => '未配置高德 key，无法规划路线'], 503);
    }
    if (!valid_lnglat($origin) || !valid_lnglat($destination)) {
        r_out(['error' => 'bad_params', 'message' => '起点/终点坐标不合法'], 400);
    }

    // 公交规划需要城市；未传则用逆地理编码自动解析 adcode
    $regeoAdcode = static function (string $loc) use ($key): string {
        $r = amap_get('geocode/regeo', ['location' => $loc], $key);
        return (string) ($r['regeocode']['addressComponent']['adcode'] ?? '');
    };
    if ($city === '') {
        $city = $regeoAdcode($origin);
    }
    if ($cityd === '') {
        $cityd = $regeoAdcode($destination) ?: $city;
    }

    $options = [];

    // 步行
    $walk = amap_get('direction/walking', ['origin' => $origin, 'destination' => $destination], $key);
    if ($walk && ($walk['status'] ?? '0') === '1' && !empty($walk['route']['paths'][0])) {
        $p = $walk['route']['paths'][0];
        $options['walking'] = [
            'distance' => (int) ($p['distance'] ?? 0),
            'duration' => (int) round(((int) ($p['duration'] ?? 0)) / 60),
        ];
    }

    // 驾车（extensions=all 才会返回 taxi_cost 打车预估价）
    $drive = amap_get('direction/driving', ['origin' => $origin, 'destination' => $destination, 'extensions' => 'all'], $key);
    if ($drive && ($drive['status'] ?? '0') === '1' && !empty($drive['route']['paths'][0])) {
        $p = $drive['route']['paths'][0];
        $taxi = $drive['route']['taxi_cost'] ?? '';
        $options['driving'] = [
            'distance' => (int) ($p['distance'] ?? 0),
            'duration' => (int) round(((int) ($p['duration'] ?? 0)) / 60),
            'tolls' => (float) ($p['tolls'] ?? 0),
            'lights' => (int) ($p['traffic_lights'] ?? 0),
            'taxiCost' => is_numeric($taxi) ? (int) round((float) $taxi) : 0,
        ];
    }

    // 公交 / 地铁
    $transit = amap_get('direction/transit/integrated', [
        'origin' => $origin,
        'destination' => $destination,
        'city' => $city !== '' ? $city : '',
        'cityd' => $cityd !== '' ? $cityd : '',
        'strategy' => 0,
    ], $key);
    if ($transit && ($transit['status'] ?? '0') === '1' && !empty($transit['route']['transits'][0])) {
        // 判断一条公交线路是否为地铁/轨道
        $isMetroLine = static function (array $bl): bool {
            $type = (string) ($bl['type'] ?? '');
            $name = (string) ($bl['name'] ?? '');
            foreach (['地铁', '轨道', '号线', '磁悬浮', '轻轨', 'subway', 'metro'] as $kw) {
                if ($kw !== '' && (mb_stripos($type, $kw) !== false || mb_stripos($name, $kw) !== false)) return true;
            }
            return false;
        };
        // 统计某方案里的地铁段数（用于"有地铁优先地铁"）
        $metroSegCount = static function (array $plan) use ($isMetroLine): int {
            $n = 0;
            foreach (($plan['segments'] ?? []) as $seg) {
                if (!empty($seg['bus']['buslines'][0]) && $isMetroLine($seg['bus']['buslines'][0])) $n++;
            }
            return $n;
        };
        // 从所有候选里挑：优先含地铁的方案，其次同类里耗时最短；都没地铁则用高德推荐的第一条
        $plans = $transit['route']['transits'];
        $best = null; $bestScore = null;
        foreach ($plans as $idx => $plan) {
            $metro = $metroSegCount($plan);
            $dur = (int) ($plan['duration'] ?? 0);
            // 评分元组：地铁优先(降序) → 耗时(升序) → 原始顺序(升序)
            $score = [-$metro, $dur, $idx];
            if ($bestScore === null
                || $score[0] < $bestScore[0]
                || ($score[0] === $bestScore[0] && $score[1] < $bestScore[1])
                || ($score[0] === $bestScore[0] && $score[1] === $bestScore[1] && $score[2] < $bestScore[2])) {
                $bestScore = $score; $best = $plan;
            }
        }
        $t = $best ?: $plans[0];
        $usesMetro = $metroSegCount($t) > 0;
        // 高德返回的运营时间形如 "2300"；规整成 HH:MM
        $fmtTime = static function (string $hhmm): string {
            $hhmm = preg_replace('/\D/', '', $hhmm);
            if (strlen($hhmm) !== 4) return '';
            return substr($hhmm, 0, 2) . ':' . substr($hhmm, 2, 2);
        };
        $steps = [];
        $lines = [];      // 本方案各条线路的末班车
        $lastBus = null;  // 最早收车的那条（整段行程的瓶颈）
        foreach ($t['segments'] as $seg) {
            $walkDist = (int) ($seg['walking']['distance'] ?? 0);
            if ($walkDist >= 50) {
                $steps[] = '步行约 ' . $walkDist . ' 米';
            }
            if (!empty($seg['bus']['buslines'][0])) {
                $bl = $seg['bus']['buslines'][0];
                $name = (string) ($bl['name'] ?? '');
                $dep = (string) ($bl['departure_stop']['name'] ?? '');
                $arr = (string) ($bl['arrival_stop']['name'] ?? '');
                $via = (int) ($bl['via_num'] ?? 0);
                $metro = $isMetroLine($bl);
                $verb = $metro ? '🚇 搭地铁 ' : '🚌 乘 ';
                $steps[] = $verb . $name . '，' . $dep . ' 上车 → ' . $arr . ' 下车' . ($via > 0 ? '（途经 ' . $via . ' 站）' : '');
                $rawEnd = $bl['end_time'] ?? '';
                $end = is_scalar($rawEnd) ? $fmtTime((string) $rawEnd) : '';
                if ($end !== '') {
                    $lines[] = ['name' => $name, 'metro' => $metro, 'last' => $end, 'depart' => $dep];
                    if ($lastBus === null || $end < $lastBus['last']) {
                        $lastBus = ['name' => $name, 'metro' => $metro, 'last' => $end, 'depart' => $dep];
                    }
                }
            } elseif (!empty($seg['railway']['name'])) {
                $rw = $seg['railway'];
                $steps[] = '🚄 乘 ' . $rw['name'] . '，' . ($rw['departure_stop']['name'] ?? '') . ' → ' . ($rw['arrival_stop']['name'] ?? '');
            }
        }
        $cost = $t['cost'] ?? ($t['cost']['transit_fee'] ?? 0);
        $options['transit'] = [
            'duration' => (int) round(((int) ($t['duration'] ?? 0)) / 60),
            'walkingDistance' => (int) ($t['walking_distance'] ?? 0),
            'cost' => is_numeric($cost) ? (float) $cost : 0,
            'usesMetro' => $usesMetro,
            'steps' => $steps,
            'lines' => $lines,
            'lastBus' => $lastBus,
        ];
    }

    // 推荐：很近就走路；否则优先公交/地铁；都没有就驾车
    $recommend = null;
    $walkDist = $options['walking']['distance'] ?? PHP_INT_MAX;
    if ($walkDist <= 1500) {
        $recommend = 'walking';
    } elseif (isset($options['transit'])) {
        $recommend = 'transit';
    } elseif (isset($options['driving'])) {
        $recommend = 'driving';
    } elseif (isset($options['walking'])) {
        $recommend = 'walking';
    }

    if (!$options) {
        r_out(['error' => 'no_route', 'message' => '未能规划出路线'], 404);
    }

    r_out([
        'ok' => true,
        'recommend' => $recommend,
        'options' => $options,
    ]);
} catch (Throwable $error) {
    r_out(['error' => 'server_error', 'message' => 'route failed'], 500);
}
