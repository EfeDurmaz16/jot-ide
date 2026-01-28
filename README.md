# Jotform Code Interview Platform

A secure, multi-language code execution platform designed for technical interviews. Features Jotform branding, Monaco Editor integration, and sandboxed execution via nsjail.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Frontend (Browser)                        │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │  Monaco Editor  │  │   API Client    │  │ Jotform Theme   │ │
│  └────────┬────────┘  └────────┬────────┘  └─────────────────┘ │
└───────────┼─────────────────────┼────────────────────────────────┘
            │                     │
            ▼                     ▼
┌─────────────────────────────────────────────────────────────────┐
│                     PHP API (Orchestrator)                       │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────────┐│
│  │execute.php│ │status.php│ │languages │  │    config.php    ││
│  │           │ │          │ │  .php    │  │ (rate limit,     ││
│  │ - Cache   │ │ - Poll   │ │          │  │  lang configs)   ││
│  │ - Queue   │ │ - Result │ │          │  │                  ││
│  └─────┬─────┘ └────┬─────┘ └──────────┘  └──────────────────┘│
└────────┼────────────┼────────────────────────────────────────────┘
         │            │
         ▼            ▼
┌─────────────────────────────────────────────────────────────────┐
│                          Redis                                   │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────────┐│
│  │ BullMQ Queue │  │ Job Results  │  │   Execution Cache      ││
│  │ (waiting)    │  │ (5min TTL)   │  │   (1hr TTL, SHA256)    ││
│  └──────┬───────┘  └──────────────┘  └────────────────────────┘│
└─────────┼────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Node.js Worker (BullMQ)                       │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ 1. Create workspace  │ 2. Write code  │ 3. Compile (opt) │  │
│  │ 4. Execute in nsjail │ 5. Capture I/O │ 6. Store result  │  │
│  │ 7. Cache if success  │ 8. Cleanup     │                  │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────────┐
│                    nsjail Sandbox                                │
│  ┌────────────────────────────────────────────────────────────┐│
│  │ • Namespace isolation (PID, NET, UTS, IPC, USER, MNT)     ││
│  │ • Resource limits (memory, CPU, file size, processes)     ││
│  │ • Seccomp syscall filtering                                ││
│  │ • Read-only system mounts                                  ││
│  │ • No network access                                        ││
│  └────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

## Features

- **7 Languages**: Python, C, C++, Java, Go, Rust, PHP
- **Secure Execution**: nsjail sandboxing with namespace isolation
- **Smart Caching**: SHA256-based caching of execution results
- **Rate Limiting**: 10 executions per minute per IP
- **Monaco Editor**: Syntax highlighting, autocomplete, line numbers
- **Jotform Branding**: Orange/Blue/Navy theme, clean design

## Prerequisites

- **OS**: Linux (nsjail requires Linux kernel features)
- **PHP**: 8.1+ with Redis extension
- **Node.js**: 18+
- **Redis**: 6+
- **nsjail**: Installed and configured
- **Compilers**: gcc, g++, javac, go, rustc, python3, php

## Installation

### 1. Clone and Install Dependencies

```bash
# Clone repository
cd /var/www/code-executor

# Install PHP dependencies
composer install

# Install Node.js dependencies
cd workers && npm install && cd ..
```

### 2. Install nsjail

```bash
# Ubuntu/Debian
sudo apt-get install nsjail

# Or build from source
git clone https://github.com/google/nsjail.git
cd nsjail && make && sudo cp nsjail /usr/bin/
```

### 3. Install Compilers

```bash
# Ubuntu/Debian
sudo apt-get install gcc g++ openjdk-17-jdk golang rustc python3 php-cli
```

### 4. Configure Directories

```bash
# Create sandbox directories
sudo mkdir -p /var/www/code-executor/sandbox/{jobs,root}
sudo chown -R www-data:www-data /var/www/code-executor/sandbox

# Set permissions
chmod 755 /var/www/code-executor/sandbox/jobs
```

### 5. Start Services

```bash
# Start Redis
redis-server

# Start Worker (in separate terminal)
cd /var/www/code-executor/workers
node worker.js

# Start PHP Server (development)
cd /var/www/code-executor
php -S localhost:8000 -t public
```

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `REDIS_HOST` | `127.0.0.1` | Redis server host |
| `REDIS_PORT` | `6379` | Redis server port |
| `REDIS_PASSWORD` | - | Redis password (optional) |
| `WORKER_CONCURRENCY` | `4` | Worker concurrency |
| `SANDBOX_JOBS` | `/var/www/code-executor/sandbox/jobs` | Job workspace directory |
| `NSJAIL_CONFIG_DIR` | `/var/www/code-executor/config/nsjail` | nsjail config directory |

### Language Limits

| Language | Timeout | Memory | Notes |
|----------|---------|--------|-------|
| Python | 30s | 256MB | Interpreted |
| C | 60s | 512MB | Compiled with gcc |
| C++ | 60s | 512MB | Compiled with g++ (C++17) |
| Java | 60s | 768MB | Compiled with javac |
| Go | 60s | 512MB | Compiled with go build |
| Rust | 90s | 1GB | Compiled with rustc |
| PHP | 30s | 256MB | Interpreted |

## API Reference

### POST /api/execute.php

Execute code in specified language.

**Request:**
```json
{
    "language": "python",
    "code": "print('Hello, World!')"
}
```

**Response (queued):**
```json
{
    "success": true,
    "jobId": "job_65abc123.456789",
    "status": "queued",
    "cached": false
}
```

**Response (cached):**
```json
{
    "success": true,
    "jobId": "cached_65abc123.456789",
    "status": "completed",
    "cached": true,
    "result": {
        "stdout": "Hello, World!\n",
        "stderr": "",
        "exitCode": 0,
        "executionTime": 45
    }
}
```

### GET /api/status.php?jobId={id}

Get job status and result.

**Response:**
```json
{
    "success": true,
    "jobId": "job_65abc123.456789",
    "status": "completed",
    "result": {
        "stdout": "Hello, World!\n",
        "stderr": "",
        "exitCode": 0,
        "executionTime": 150
    }
}
```

### GET /api/languages.php

Get supported languages and configuration.

**Response:**
```json
{
    "success": true,
    "languages": {
        "python": {
            "id": "python",
            "name": "Python 3",
            "extension": "py",
            "timeout": 30,
            "memoryLimit": "256MB",
            "compiled": false,
            "helloWorld": "print(\"Hello, World!\")"
        }
    },
    "rateLimit": {
        "max": 10,
        "windowSeconds": 60
    }
}
```

## Security

See [SECURITY.md](SECURITY.md) for detailed security documentation.

### Key Security Features

1. **Process Isolation**: nsjail namespaces (PID, NET, UTS, IPC, USER, MNT)
2. **Resource Limits**: Memory, CPU time, file size, process count
3. **Syscall Filtering**: Seccomp profiles restrict available syscalls
4. **Network Disabled**: No outbound network access from sandbox
5. **Read-only Mounts**: System directories mounted read-only
6. **Input Validation**: Strict language whitelist, code size limits
7. **Rate Limiting**: Prevents abuse (10 requests/min/IP)
8. **No Shell Execution**: Worker uses spawn, not shell

## Development

### Running Tests

```bash
# Test each language
curl -X POST http://localhost:8000/api/execute.php \
    -H "Content-Type: application/json" \
    -d '{"language": "python", "code": "print(\"test\")"}'
```

### Directory Structure

```
/var/www/code-executor/
├── public/              # Frontend assets
│   ├── index.html
│   ├── css/jotform-theme.css
│   ├── js/editor.js
│   ├── js/api-client.js
│   └── assets/jotform-logo.svg
├── api/                 # PHP API
│   ├── execute.php
│   ├── status.php
│   ├── languages.php
│   └── config.php
├── workers/             # Node.js workers
│   ├── package.json
│   ├── worker.js
│   └── executor.js
├── config/nsjail/       # nsjail configs
│   ├── python.cfg
│   ├── c.cfg
│   └── ...
└── sandbox/             # Execution sandbox
    ├── jobs/            # Temporary workspaces
    └── root/            # Jail root (optional)
```

## Deployment

See [DEPLOYMENT.md](DEPLOYMENT.md) for production deployment guide.

## License

Proprietary - Jotform Inc.
