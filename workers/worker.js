const Redis = require('ioredis');
const { executeCode } = require('./executor');

const REDIS_HOST = process.env.REDIS_HOST || '127.0.0.1';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379', 10);
const QUEUE_NAME = 'code-execution';
const CONCURRENCY = parseInt(process.env.WORKER_CONCURRENCY || '4', 10);
const JOB_RESULT_TTL = 300;
const CACHE_TTL = 3600;

const redis = new Redis({ host: REDIS_HOST, port: REDIS_PORT });
const subscriber = new Redis({ host: REDIS_HOST, port: REDIS_PORT });

let activeJobs = 0;

function getCacheKey(language, code) {
    const crypto = require('crypto');
    return 'cache:' + crypto.createHash('sha256').update(language + ':' + code).digest('hex');
}

async function processJob(jobData) {
    const { id: jobId, language, code } = jobData;
    const startTime = Date.now();

    console.log(`[${jobId}] Processing ${language} job...`);

    try {
        await redis.setex(`job:status:${jobId}`, JOB_RESULT_TTL, JSON.stringify({
            status: 'processing',
            startedAt: Math.floor(startTime / 1000)
        }));

        const result = await executeCode(jobId, language, code);
        result.executionTime = Date.now() - startTime;

        await redis.setex(`job:result:${jobId}`, JOB_RESULT_TTL, JSON.stringify(result));

        if (result.exitCode === 0 && !result.compileError) {
            const cacheKey = getCacheKey(language, code);
            await redis.setex(cacheKey, CACHE_TTL, JSON.stringify(result));
            console.log(`[${jobId}] Result cached`);
        }

        await redis.del(`job:status:${jobId}`);
        console.log(`[${jobId}] Completed in ${result.executionTime}ms (exit: ${result.exitCode})`);

    } catch (error) {
        console.error(`[${jobId}] Error:`, error.message);
        await redis.setex(`job:result:${jobId}`, JOB_RESULT_TTL, JSON.stringify({
            stdout: '',
            stderr: error.message || 'Unknown error',
            exitCode: -1,
            error: true,
            executionTime: Date.now() - startTime
        }));
        await redis.del(`job:status:${jobId}`);
    } finally {
        activeJobs--;
    }
}

async function pollQueue() {
    while (true) {
        try {
            if (activeJobs >= CONCURRENCY) {
                await new Promise(r => setTimeout(r, 100));
                continue;
            }

            const item = await subscriber.brpop('queue:' + QUEUE_NAME, 1);

            if (item) {
                const jobData = JSON.parse(item[1]);
                activeJobs++;
                processJob(jobData).catch(err => {
                    console.error('Job processing error:', err);
                    activeJobs--;
                });
            }
        } catch (err) {
            console.error('Queue poll error:', err.message);
            await new Promise(r => setTimeout(r, 1000));
        }
    }
}

console.log('Starting code execution worker...');
console.log(`Connected to Redis at ${REDIS_HOST}:${REDIS_PORT}`);
console.log(`Listening on queue: ${QUEUE_NAME} (concurrency: ${CONCURRENCY})`);

pollQueue();

process.on('SIGTERM', async () => {
    console.log('Shutting down...');
    await redis.quit();
    await subscriber.quit();
    process.exit(0);
});
process.on('SIGINT', async () => {
    console.log('Shutting down...');
    await redis.quit();
    await subscriber.quit();
    process.exit(0);
});
