<?php
declare(strict_types=1);

// Redis Configuration
define('REDIS_HOST', getenv('REDIS_HOST') ?: '127.0.0.1');
define('REDIS_PORT', (int)(getenv('REDIS_PORT') ?: 6379));
define('REDIS_PASSWORD', getenv('REDIS_PASSWORD') ?: null);

// Rate Limiting
define('RATE_LIMIT_MAX', 10);
define('RATE_LIMIT_WINDOW', 60); // seconds

// Cache TTLs
define('CACHE_TTL', 3600); // 1 hour for execution cache
define('JOB_RESULT_TTL', 300); // 5 minutes for job results

// Sandbox paths (configurable via environment)
define('APP_ROOT', getenv('APP_ROOT') ?: '/var/www/code-executor');
define('SANDBOX_BASE', APP_ROOT . '/sandbox');
define('SANDBOX_JOBS', SANDBOX_BASE . '/jobs');
define('NSJAIL_CONFIG_DIR', APP_ROOT . '/config/nsjail');

// Queue name
define('QUEUE_NAME', 'code-execution');

// Language configurations
const LANGUAGE_CONFIG = [
    'python' => [
        'name' => 'Python 3',
        'extension' => 'py',
        'compile' => false,
        'binary' => '/usr/bin/python3',
        'timeout' => 30,
        'memory_limit' => 268435456, // 256MB
        'nsjail_config' => 'python.cfg',
        'hello_world' => 'print("Hello, World!")'
    ],
    'c' => [
        'name' => 'C (GCC)',
        'extension' => 'c',
        'compile' => true,
        'compiler' => '/usr/bin/gcc',
        'compile_args' => ['-O2', '-Wall', '-o', 'output'],
        'binary' => './output',
        'timeout' => 60,
        'memory_limit' => 536870912, // 512MB
        'nsjail_config' => 'c.cfg',
        'hello_world' => '#include <stdio.h>\nint main() {\n    printf("Hello, World!\\n");\n    return 0;\n}'
    ],
    'cpp' => [
        'name' => 'C++ (G++)',
        'extension' => 'cpp',
        'compile' => true,
        'compiler' => '/usr/bin/g++',
        'compile_args' => ['-O2', '-Wall', '-std=c++17', '-o', 'output'],
        'binary' => './output',
        'timeout' => 60,
        'memory_limit' => 536870912, // 512MB
        'nsjail_config' => 'cpp.cfg',
        'hello_world' => '#include <iostream>\nint main() {\n    std::cout << "Hello, World!" << std::endl;\n    return 0;\n}'
    ],
    'java' => [
        'name' => 'Java',
        'extension' => 'java',
        'compile' => true,
        'compiler' => '/usr/bin/javac',
        'compile_args' => [],
        'binary' => '/usr/bin/java',
        'run_args' => ['Main'],
        'timeout' => 60,
        'memory_limit' => 805306368, // 768MB
        'nsjail_config' => 'java.cfg',
        'source_filename' => 'Main.java',
        'hello_world' => 'public class Main {\n    public static void main(String[] args) {\n        System.out.println("Hello, World!");\n    }\n}'
    ],
    'go' => [
        'name' => 'Go',
        'extension' => 'go',
        'compile' => true,
        'compiler' => '/usr/bin/go',
        'compile_args' => ['build', '-o', 'output'],
        'binary' => './output',
        'timeout' => 60,
        'memory_limit' => 536870912, // 512MB
        'nsjail_config' => 'go.cfg',
        'hello_world' => 'package main\n\nimport "fmt"\n\nfunc main() {\n    fmt.Println("Hello, World!")\n}'
    ],
    'rust' => [
        'name' => 'Rust',
        'extension' => 'rs',
        'compile' => true,
        'compiler' => '/usr/bin/rustc',
        'compile_args' => ['-O', '-o', 'output'],
        'binary' => './output',
        'timeout' => 90,
        'memory_limit' => 1073741824, // 1GB
        'nsjail_config' => 'rust.cfg',
        'hello_world' => 'fn main() {\n    println!("Hello, World!");\n}'
    ],
    'php' => [
        'name' => 'PHP',
        'extension' => 'php',
        'compile' => false,
        'binary' => '/usr/bin/php',
        'timeout' => 30,
        'memory_limit' => 268435456, // 256MB
        'nsjail_config' => 'php.cfg',
        'hello_world' => '<?php\necho "Hello, World!\\n";'
    ]
];

/**
 * Get Redis connection using Predis
 */
function getRedis(): \Predis\Client {
    static $redis = null;

    if ($redis === null) {
        $options = [
            'scheme' => 'tcp',
            'host' => REDIS_HOST,
            'port' => REDIS_PORT,
        ];

        if (REDIS_PASSWORD) {
            $options['password'] = REDIS_PASSWORD;
        }

        $redis = new \Predis\Client($options);
    }

    return $redis;
}

/**
 * Generate cache key from language and code
 */
function getCacheKey(string $language, string $code): string {
    return 'cache:' . hash('sha256', $language . ':' . $code);
}

/**
 * Check rate limit for IP
 * Returns true if within limit, false if exceeded
 */
function checkRateLimit(string $ip): bool {
    $redis = getRedis();
    $key = 'ratelimit:' . hash('sha256', $ip);

    $current = (int) $redis->get($key);

    if ($current >= RATE_LIMIT_MAX) {
        return false;
    }

    $redis->incr($key);

    if ($current === 0) {
        $redis->expire($key, RATE_LIMIT_WINDOW);
    }

    return true;
}

/**
 * Validate language is supported
 */
function isValidLanguage(string $language): bool {
    return isset(LANGUAGE_CONFIG[$language]);
}

/**
 * Get client IP address
 */
function getClientIp(): string {
    return $_SERVER['HTTP_X_FORWARDED_FOR']
        ?? $_SERVER['HTTP_X_REAL_IP']
        ?? $_SERVER['REMOTE_ADDR']
        ?? '127.0.0.1';
}

/**
 * Send JSON response with CORS headers
 */
function sendJson(array $data, int $statusCode = 200): void {
    http_response_code($statusCode);
    header('Content-Type: application/json');
    header('Access-Control-Allow-Origin: *');
    header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type');

    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

/**
 * Send error response
 */
function sendError(string $message, int $statusCode = 400): void {
    sendJson(['error' => $message, 'success' => false], $statusCode);
}

// Handle preflight requests
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    header('Access-Control-Allow-Origin: *');
    header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type');
    http_response_code(204);
    exit;
}
