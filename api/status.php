<?php
declare(strict_types=1);

require_once __DIR__ . '/../vendor/autoload.php';
require_once __DIR__ . '/config.php';

// Only accept GET requests
if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    sendError('Method not allowed', 405);
}

// Get job ID from query parameter
$jobId = $_GET['jobId'] ?? null;

if (!$jobId) {
    sendError('Missing required parameter: jobId');
}

// Validate job ID format (prevent injection)
if (!preg_match('/^(job_|cached_)[a-zA-Z0-9._]+$/', $jobId)) {
    sendError('Invalid job ID format');
}

try {
    $redis = getRedis();

    // Check for job result
    $resultKey = 'job:result:' . $jobId;
    $resultData = $redis->get($resultKey);

    if ($resultData) {
        $result = json_decode($resultData, true);
        sendJson([
            'success' => true,
            'jobId' => $jobId,
            'status' => 'completed',
            'result' => $result
        ]);
    }

    // Check for job status
    $statusKey = 'job:status:' . $jobId;
    $statusData = $redis->get($statusKey);

    if ($statusData) {
        $status = json_decode($statusData, true);
        sendJson([
            'success' => true,
            'jobId' => $jobId,
            'status' => $status['status'] ?? 'pending',
            'createdAt' => $status['createdAt'] ?? null
        ]);
    }

    // Job not found
    sendError('Job not found', 404);

} catch (\Exception $e) {
    error_log('Status error: ' . $e->getMessage());
    sendError('Internal server error', 500);
}
