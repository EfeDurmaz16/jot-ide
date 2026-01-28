const { spawn } = require('child_process');
const fs = require('fs').promises;
const path = require('path');

// Configuration paths
const SANDBOX_JOBS = process.env.SANDBOX_JOBS || '/var/www/code-executor/sandbox/jobs';
const NSJAIL_CONFIG_DIR = process.env.NSJAIL_CONFIG_DIR || '/var/www/code-executor/config/nsjail';
const NSJAIL_BIN = process.env.NSJAIL_BIN || '/usr/bin/nsjail';

// Language configurations (must match PHP config)
const LANGUAGE_CONFIG = {
    python: {
        extension: 'py',
        compile: false,
        binary: '/usr/bin/python3',
        timeout: 30000,
        sourceFile: 'main.py'
    },
    c: {
        extension: 'c',
        compile: true,
        compiler: '/usr/bin/gcc',
        compileArgs: ['-O2', '-Wall', '-o', 'output'],
        binary: './output',
        timeout: 60000,
        sourceFile: 'main.c'
    },
    cpp: {
        extension: 'cpp',
        compile: true,
        compiler: '/usr/bin/g++',
        compileArgs: ['-O2', '-Wall', '-std=c++17', '-o', 'output'],
        binary: './output',
        timeout: 60000,
        sourceFile: 'main.cpp'
    },
    java: {
        extension: 'java',
        compile: true,
        compiler: '/usr/bin/javac',
        compileArgs: [],
        binary: '/usr/bin/java',
        runArgs: ['-Xmx512m', 'Main'],
        timeout: 60000,
        sourceFile: 'Main.java'
    },
    go: {
        extension: 'go',
        compile: true,
        compiler: '/usr/lib/go-1.24/bin/go',
        compileArgs: ['build', '-o', 'output'],
        binary: './output',
        timeout: 60000,
        sourceFile: 'main.go',
        env: { GOPATH: '/tmp/go', GOCACHE: '/tmp/go-cache' }
    },
    rust: {
        extension: 'rs',
        compile: true,
        compiler: '/usr/bin/rustc',
        compileArgs: ['-O', '-o', 'output'],
        binary: './output',
        timeout: 90000,
        sourceFile: 'main.rs'
    },
    php: {
        extension: 'php',
        compile: false,
        binary: '/usr/bin/php',
        runArgs: ['-d', 'display_errors=stderr'],
        timeout: 30000,
        sourceFile: 'main.php'
    }
};

/**
 * Execute code in a sandboxed environment
 */
async function executeCode(jobId, language, code) {
    const config = LANGUAGE_CONFIG[language];
    if (!config) {
        throw new Error(`Unsupported language: ${language}`);
    }

    const workDir = path.join(SANDBOX_JOBS, jobId);

    try {
        // Create workspace directory
        await fs.mkdir(workDir, { recursive: true });

        // Write source code
        const sourceFile = path.join(workDir, config.sourceFile);
        await fs.writeFile(sourceFile, code, 'utf8');

        let result;

        // Compile if needed
        if (config.compile) {
            const compileResult = await compileCode(workDir, language, config);

            if (compileResult.exitCode !== 0) {
                return {
                    stdout: '',
                    stderr: compileResult.stderr,
                    exitCode: compileResult.exitCode,
                    compileError: true
                };
            }
        }

        // Execute in nsjail
        result = await runInSandbox(workDir, language, config);

        return result;

    } finally {
        // Cleanup workspace
        await cleanup(workDir);
    }
}

/**
 * Compile source code
 */
async function compileCode(workDir, language, config) {
    return new Promise((resolve) => {
        const args = [...config.compileArgs, config.sourceFile];

        const spawnOpts = {
            cwd: workDir,
            timeout: 30000,
            stdio: ['pipe', 'pipe', 'pipe']
        };
        if (config.env) {
            spawnOpts.env = { ...process.env, ...config.env };
        }

        const proc = spawn(config.compiler, args, spawnOpts);

        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', (data) => {
            stdout += data.toString();
        });

        proc.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        proc.on('close', (code) => {
            resolve({
                stdout: stdout.slice(0, 65536),
                stderr: stderr.slice(0, 65536),
                exitCode: code || 0
            });
        });

        proc.on('error', (err) => {
            resolve({
                stdout: '',
                stderr: err.message,
                exitCode: -1
            });
        });

        // Timeout handling
        setTimeout(() => {
            proc.kill('SIGKILL');
        }, 30000);
    });
}

/**
 * Run code in nsjail sandbox
 */
async function runInSandbox(workDir, language, config) {
    return new Promise(async (resolve) => {
        // Read and prepare nsjail config
        const configPath = path.join(NSJAIL_CONFIG_DIR, `${language}.cfg`);
        let nsjailConfig;

        try {
            nsjailConfig = await fs.readFile(configPath, 'utf8');
            // Replace workspace placeholder
            nsjailConfig = nsjailConfig.replace(/\{\{WORKSPACE\}\}/g, workDir);
        } catch (err) {
            resolve({
                stdout: '',
                stderr: `Failed to load nsjail config: ${err.message}`,
                exitCode: -1
            });
            return;
        }

        // Write temporary config
        const tmpConfigPath = path.join(workDir, 'nsjail.cfg');
        await fs.writeFile(tmpConfigPath, nsjailConfig, 'utf8');

        // Build nsjail command args
        const args = [
            '--config', tmpConfigPath,
            '--'
        ];

        // Add execution command based on language
        if (config.compile) {
            args.push(config.binary);
            if (config.runArgs) {
                args.push(...config.runArgs);
            }
        } else {
            args.push(config.binary);
            if (config.runArgs) {
                args.push(...config.runArgs);
            }
            args.push(config.sourceFile);
        }

        const proc = spawn(NSJAIL_BIN, args, {
            cwd: workDir,
            timeout: config.timeout,
            stdio: ['pipe', 'pipe', 'pipe']
        });

        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', (data) => {
            stdout += data.toString();
            // Limit output size
            if (stdout.length > 65536) {
                proc.kill('SIGKILL');
            }
        });

        proc.stderr.on('data', (data) => {
            stderr += data.toString();
            if (stderr.length > 65536) {
                proc.kill('SIGKILL');
            }
        });

        proc.on('close', (code, signal) => {
            let exitCode = code;
            let finalStderr = stderr;

            if (signal === 'SIGKILL') {
                if (stdout.length > 65536 || stderr.length > 65536) {
                    finalStderr = 'Output exceeded maximum size (64KB)';
                } else {
                    finalStderr = 'Execution timeout exceeded';
                }
                exitCode = -1;
            }

            // Filter out nsjail log messages from stderr
            finalStderr = finalStderr
                .split('\n')
                .filter(line => !line.startsWith('[') || !line.includes('nsjail'))
                .join('\n')
                .trim();

            resolve({
                stdout: stdout.slice(0, 65536),
                stderr: finalStderr.slice(0, 65536),
                exitCode: exitCode || 0
            });
        });

        proc.on('error', (err) => {
            resolve({
                stdout: '',
                stderr: err.message,
                exitCode: -1
            });
        });

        // Timeout safety net
        setTimeout(() => {
            proc.kill('SIGKILL');
        }, config.timeout + 5000);
    });
}

/**
 * Clean up workspace directory
 */
async function cleanup(workDir) {
    try {
        await fs.rm(workDir, { recursive: true, force: true });
    } catch (err) {
        console.error(`Cleanup failed for ${workDir}:`, err.message);
    }
}

module.exports = { executeCode };
