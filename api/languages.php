<?php
declare(strict_types=1);

require_once __DIR__ . '/config.php';

// Only accept GET requests
if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    sendError('Method not allowed', 405);
}

// Build public language info (exclude sensitive config)
$languages = [];

foreach (LANGUAGE_CONFIG as $id => $config) {
    $languages[$id] = [
        'id' => $id,
        'name' => $config['name'],
        'extension' => $config['extension'],
        'timeout' => $config['timeout'],
        'memoryLimit' => formatBytes($config['memory_limit']),
        'compiled' => $config['compile'],
        'helloWorld' => $config['hello_world']
    ];
}

/**
 * Format bytes to human readable
 */
function formatBytes(int $bytes): string {
    if ($bytes >= 1073741824) {
        return round($bytes / 1073741824, 1) . 'GB';
    }
    if ($bytes >= 1048576) {
        return round($bytes / 1048576, 0) . 'MB';
    }
    if ($bytes >= 1024) {
        return round($bytes / 1024, 0) . 'KB';
    }
    return $bytes . 'B';
}

sendJson([
    'success' => true,
    'languages' => $languages,
    'rateLimit' => [
        'max' => RATE_LIMIT_MAX,
        'windowSeconds' => RATE_LIMIT_WINDOW
    ]
]);
