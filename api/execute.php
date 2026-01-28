<?php
declare(strict_types=1);

require_once __DIR__ . '/../vendor/autoload.php';
require_once __DIR__ . '/config.php';

// Only accept POST requests
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    sendError('Method not allowed', 405);
}

// Parse JSON body
$input = json_decode(file_get_contents('php://input'), true);

if (!$input) {
    sendError('Invalid JSON body');
}

// Validate required fields
$language = $input['language'] ?? null;
$code = $input['code'] ?? null;

if (!$language || !$code) {
    sendError('Missing required fields: language and code');
}

// Validate language
if (!isValidLanguage($language)) {
    sendError('Unsupported language: ' . $language);
}

// Sanitize code - only trim, don't modify content
$code = trim($code);

if (empty($code)) {
    sendError('Code cannot be empty');
}

// Check code length (max 64KB)
if (strlen($code) > 65536) {
    sendError('Code exceeds maximum length of 64KB');
}

// Check rate limit
$clientIp = getClientIp();
if (!checkRateLimit($clientIp)) {
    sendError('Rate limit exceeded. Maximum ' . RATE_LIMIT_MAX . ' executions per minute.', 429);
}

try {
    $redis = getRedis();

    // Check cache first
    $cacheKey = getCacheKey($language, $code);
    $cachedResult = $redis->get($cacheKey);

    if ($cachedResult) {
        $result = json_decode($cachedResult, true);
        sendJson([
            'success' => true,
            'jobId' => 'cached_' . uniqid('', true),
            'status' => 'completed',
            'cached' => true,
            'result' => $result
        ]);
    }

    // Generate job ID
    $jobId = uniqid('job_', true);

    // Create job data
    $jobData = [
        'id' => $jobId,
        'language' => $language,
        'code' => $code,
        'createdAt' => time(),
        'clientIp' => hash('sha256', $clientIp) // Store hashed IP for debugging
    ];

    // Push to BullMQ queue using Redis directly
    // BullMQ uses specific Redis data structures
    $queueKey = 'bull:' . QUEUE_NAME . ':waiting';
    $jobKey = 'bull:' . QUEUE_NAME . ':' . $jobId;

    // Store job data
    $redis->hset($jobKey, 'data', json_encode($jobData));
    $redis->hset($jobKey, 'opts', json_encode(['attempts' => 3, 'timeout' => 120000]));
    $redis->hset($jobKey, 'timestamp', (string) (time() * 1000));

    // Add to waiting list (BullMQ format)
    $redis->lpush($queueKey, $jobId);

    // Set initial job status
    $redis->setex('job:status:' . $jobId, JOB_RESULT_TTL, json_encode([
        'status' => 'pending',
        'createdAt' => time()
    ]));

    sendJson([
        'success' => true,
        'jobId' => $jobId,
        'status' => 'queued',
        'cached' => false
    ]);

} catch (\Exception $e) {
    error_log('Execute error: ' . $e->getMessage());
    sendError('Internal server error', 500);
}
