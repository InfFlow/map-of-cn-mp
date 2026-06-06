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

try {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        out(['error' => 'method_not_allowed'], 405);
    }

    $body = json_decode((string) file_get_contents('php://input'), true) ?: [];
    $photos = is_array($body['photos'] ?? null) ? $body['photos'] : [];
    $photos = array_values(array_filter($photos, static fn($p) => is_array($p) && trim((string) ($p['imageUrl'] ?? '')) !== ''));

    if (!$photos) {
        out(['groups' => [], 'highlights' => [], 'amazingPlaces' => [], 'travelNote' => '还没有可整理的照片。']);
    }

    $byCity = [];
    foreach ($photos as $p) {
        $city = trim((string) ($p['city'] ?? $p['location'] ?? '未标记地点'));
        if (!isset($byCity[$city])) {
            $byCity[$city] = [];
        }
        $byCity[$city][] = $p;
    }

    $groups = [];
    foreach ($byCity as $city => $items) {
        $groups[] = [
            'city' => $city,
            'title' => $city,
            'count' => count($items),
            'cover' => (string) ($items[0]['imageUrl'] ?? ''),
            'photos' => array_slice($items, 0, 12),
        ];
    }
    usort($groups, static fn($a, $b) => ($b['count'] <=> $a['count']) ?: strcmp($a['city'], $b['city']));

    $highlights = array_slice(array_map(static fn($p) => [
        'imageUrl' => (string) ($p['imageUrl'] ?? ''),
        'city' => (string) ($p['city'] ?? $p['location'] ?? ''),
        'title' => (string) ($p['title'] ?? ''),
        'date' => (string) ($p['date'] ?? ''),
    ], $photos), 0, 9);

    $amazingPlaces = array_slice(array_map(static fn($g) => [
        'city' => $g['city'],
        'count' => $g['count'],
        'cover' => $g['cover'],
        'reason' => $g['count'] > 1 ? '这里留下了很多画面' : '这里有一张值得重看的照片',
    ], $groups), 0, 5);

    $cityNames = array_slice(array_column($groups, 'city'), 0, 3);
    $travelNote = '这次一共整理了 ' . count($photos) . ' 张照片';
    if ($cityNames) {
        $travelNote .= '，主要来自 ' . implode('、', $cityNames);
    }
    $travelNote .= '。挑几张重新翻看，会比时间线更快想起那天的风。';

    out([
        'groups' => $groups,
        'highlights' => $highlights,
        'amazingPlaces' => $amazingPlaces,
        'travelNote' => $travelNote,
    ]);
} catch (Throwable $e) {
    out(['error' => 'server_error', 'message' => 'photo analysis failed'], 500);
}
