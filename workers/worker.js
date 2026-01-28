const { Worker } = require('bullmq');
const Redis = require('ioredis');
const { executeCode } = require('./executor');

// Configuration
const REDIS_HOST = process.env.REDIS_HOST || '127.0.0.1';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379', 10);
const REDIS_PASSWORD = process.env.REDIS_PASSWORD || undefined;
const QUEUE_NAME = 'code-execution';
const CONCURRENCY = parseInt(process.env.WORKER_CONCURRENCY || '4', 10);

// Redis connection for storing results
const redis = new Redis({
    host: REDIS_HOST,
    port: REDIS_PORT,
    password: REDIS_PASSWORD,
    maxRetriesPerRequest: null,
});

// BullMQ connection options
const connection = {
    host: REDIS_HOST,
    port: REDIS_PORT,
    password: REDIS_PASSWORD,
};

// TTLs in seconds
const JOB_RESULT_TTL = 300; // 5 minutes
const CACHE_TTL = 3600; // 1 hour

/**
 * Generate cache key from language and code
 */
function getCacheKey(language, code) {
    const crypto = require('crypto');
    return 'cache:' + crypto.createHash('sha256').update(language + ':' + code).digest('hex');
}

/**
 * Process a code execution job
 */
async function processJob(job) {
    const { id: jobId, language, code } = job.data;
    const startTime = Date.now();

    console.log(`[${jobId}] Processing ${language} job...`);

    try {
        // Update status to processing
        await redis.setex(`job:status:${jobId}`, JOB_RESULT_TTL, JSON.stringify({
            status: 'processing',
            startedAt: Math.floor(startTime / 1000)
        }));

        // Execute the code
        const result = await executeCode(jobId, language, code);

        const executionTime = Date.now() - startTime;
        result.executionTime = executionTime;

        // Store result
        await redis.setex(`job:result:${jobId}`, JOB_RESULT_TTL, JSON.stringify(result));

        // Cache successful results (no compile errors, no runtime errors)
        if (result.exitCode === 0 && !result.compileError) {
            const cacheKey = getCacheKey(language, code);
            await redis.setex(cacheKey, CACHE_TTL, JSON.stringify(result));
            console.log(`[${jobId}] Result cached`);
        }

        // Clean up status key
        await redis.del(`job:status:${jobId}`);

        console.log(`[${jobId}] Completed in ${executionTime}ms (exit: ${result.exitCode})`);

        return result;

    } catch (error) {
        console.error(`[${jobId}] Error:`, error.message);

        const errorResult = {
            stdout: '',
            stderr: error.message || 'Unknown error',
            exitCode: -1,
            error: true,
            executionTime: Date.now() - startTime
        };

        await redis.setex(`job:result:${jobId}`, JOB_RESULT_TTL, JSON.stringify(errorResult));
        await redis.del(`job:status:${jobId}`);

        throw error;
    }
}

// Create worker
const worker = new Worker(QUEUE_NAME, processJob, {
    connection,
    concurrency: CONCURRENCY,
    limiter: {
        max: 10,
        duration: 1000
    }
});

// Event handlers
worker.on('completed', (job, result) => {
    console.log(`[${job.data.id}] Job completed successfully`);
});

worker.on('failed', (job, err) => {
    console.error(`[${job?.data?.id || 'unknown'}] Job failed:`, err.message);
});

worker.on('error', (err) => {
    console.error('Worker error:', err.message);
});

worker.on('ready', () => {
    console.log(`Worker ready. Concurrency: ${CONCURRENCY}`);
    console.log(`Connected to Redis at ${REDIS_HOST}:${REDIS_PORT}`);
    console.log(`Listening on queue: ${QUEUE_NAME}`);
});

// Graceful shutdown
async function shutdown() {
    console.log('Shutting down worker...');
    await worker.close();
    await redis.quit();
    process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

console.log('Starting code execution worker...');
