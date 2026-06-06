<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
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

try {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        out(['error' => 'method_not_allowed'], 405);
    }

    $config = require dirname(__DIR__) . '/_private/config.php';
    $key = (string) ($config['amap_key'] ?? '');
    if ($key === '') {
        out(['error' => 'amap_unconfigured', 'message' => '未配置高德 key'], 503);
    }

    $body = json_decode((string) file_get_contents('php://input'), true) ?: [];
    $adcode = preg_replace('/\D/', '', (string) ($body['city'] ?? $body['adcode'] ?? ''));
    $location = trim((string) ($body['location'] ?? ''));

    if ($adcode === '' && $location !== '') {
        $re = amap_get('geocode/regeo', ['location' => $location, 'extensions' => 'base'], $key);
        $adcode = (string) ($re['regeocode']['addressComponent']['adcode'] ?? '');
    }
    if ($adcode === '') {
        out(['error' => 'bad_params', 'message' => '缺少城市或经纬度'], 400);
    }

    $live = amap_get('weather/weatherInfo', ['city' => $adcode, 'extensions' => 'base'], $key);
    $forecast = amap_get('weather/weatherInfo', ['city' => $adcode, 'extensions' => 'all'], $key);
    $l = $live['lives'][0] ?? [];
    $casts = $forecast['forecasts'][0]['casts'] ?? [];
    $today = $casts[0] ?? [];

    if (!$l && !$today) {
        out(['error' => 'weather_unavailable', 'message' => '未能获取天气'], 404);
    }

    $weather = (string) ($l['weather'] ?? $today['dayweather'] ?? '');
    $dayTemp = (string) ($today['daytemp'] ?? '');
    $nightTemp = (string) ($today['nighttemp'] ?? '');
    $city = (string) ($l['city'] ?? $forecast['forecasts'][0]['city'] ?? '');
    $tip = $weather !== ''
        ? '今天是' . $weather . '，适合慢慢走一段'
        : '今天也适合一起出门走走';

    out([
        'ok' => true,
        'city' => $city,
        'weather' => $weather,
        'temperature' => (string) ($l['temperature'] ?? $dayTemp),
        'humidity' => (string) ($l['humidity'] ?? ''),
        'winddirection' => (string) ($l['winddirection'] ?? $today['daywind'] ?? ''),
        'windpower' => (string) ($l['windpower'] ?? $today['daypower'] ?? ''),
        'dayTemp' => $dayTemp,
        'nightTemp' => $nightTemp,
        'tip' => $tip,
    ]);
} catch (Throwable $e) {
    out(['error' => 'server_error', 'message' => 'weather failed'], 500);
}
