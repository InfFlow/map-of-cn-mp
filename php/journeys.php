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

    $journeyRows = $pdo->query(
        'SELECT id, city, province, travel_date, season, weather, landmark,
                latitude, longitude, cover_tone, title, intro, sort_order
         FROM journeys
         WHERE is_visible = 1
         ORDER BY sort_order ASC, travel_date ASC, id ASC'
    )->fetchAll();

    $journeyIds = array_column($journeyRows, 'id');
    $photosByJourney = [];
    $notesByJourney = [];
    $tagsByJourney = [];

    if ($journeyIds) {
        $placeholders = implode(',', array_fill(0, count($journeyIds), '?'));

        $photoStmt = $pdo->prepare(
            "SELECT id, journey_id, title, subtitle, tone, image_url, sort_order
             FROM journey_photos
             WHERE journey_id IN ($placeholders)
             ORDER BY sort_order ASC, id ASC"
        );
        $photoStmt->execute($journeyIds);
        foreach ($photoStmt->fetchAll() as $photo) {
            $photosByJourney[$photo['journey_id']][] = [
                'id' => $photo['id'],
                'title' => $photo['title'],
                'subtitle' => $photo['subtitle'],
                'tone' => $photo['tone'],
                'imageUrl' => $photo['image_url'],
            ];
        }

        $noteStmt = $pdo->prepare(
            "SELECT journey_id, content
             FROM journey_notes
             WHERE journey_id IN ($placeholders)
             ORDER BY sort_order ASC, id ASC"
        );
        $noteStmt->execute($journeyIds);
        foreach ($noteStmt->fetchAll() as $note) {
            $notesByJourney[$note['journey_id']][] = $note['content'];
        }

        $tagStmt = $pdo->prepare(
            "SELECT journey_id, name
             FROM journey_tags
             WHERE journey_id IN ($placeholders)
             ORDER BY sort_order ASC, id ASC"
        );
        $tagStmt->execute($journeyIds);
        foreach ($tagStmt->fetchAll() as $tag) {
            $tagsByJourney[$tag['journey_id']][] = $tag['name'];
        }
    }

    $journeys = array_map(static function (array $row) use ($photosByJourney, $notesByJourney, $tagsByJourney): array {
        return [
            'id' => $row['id'],
            'city' => $row['city'],
            'province' => $row['province'],
            'date' => date('Y.m.d', strtotime($row['travel_date'])),
            'season' => $row['season'],
            'weather' => $row['weather'],
            'landmark' => $row['landmark'],
            'latitude' => (float) $row['latitude'],
            'longitude' => (float) $row['longitude'],
            'coverTone' => $row['cover_tone'],
            'title' => $row['title'],
            'intro' => $row['intro'],
            'tags' => $tagsByJourney[$row['id']] ?? [],
            'photos' => $photosByJourney[$row['id']] ?? [],
            'notes' => $notesByJourney[$row['id']] ?? [],
        ];
    }, $journeyRows);

    $anniversaryRows = $pdo->query(
        'SELECT id, label, event_date, city, repeat_yearly
         FROM anniversaries
         ORDER BY sort_order ASC, event_date ASC, id ASC'
    )->fetchAll();

    $anniversaries = array_map(static function (array $row): array {
        return [
            'id' => $row['id'],
            'label' => $row['label'],
            'date' => date('Y.m.d', strtotime($row['event_date'])),
            'city' => $row['city'],
            'repeatYearly' => (int) ($row['repeat_yearly'] ?? 0) === 1,
        ];
    }, $anniversaryRows);

    echo json_encode([
        'journeys' => $journeys,
        'anniversaries' => $anniversaries,
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
} catch (Throwable $error) {
    http_response_code(500);
    echo json_encode([
        'error' => 'server_error',
        'message' => 'Failed to load journeys',
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
}
