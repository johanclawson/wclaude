# Security Audit

This document provides a comprehensive security analysis of claude-code-win-v2.

## Executive Summary

**Risk Level:** LOW

This wrapper only hooks Node.js functions for Windows compatibility. It does not:
- Make HTTP/HTTPS calls (only DNS lookup for connectivity check - see below)
- Exfiltrate data
- Access credentials (only reads user-configured tokens from registry)
- Modify system files (only creates `~/.claude/mcp_modules` directory)
- Install persistent services

**Note on Network:** The only network operation is a DNS lookup to `api.anthropic.com` to check internet connectivity before retrying after network errors. This does not send any data.

## Code Analysis

### runner.js - Setup Functions

The wrapper runs 6 setup functions on startup:

#### Setup 1: `setupEnvironment()`

```javascript
process.env.MSYS_NO_PATHCONV = '1';
process.env.MSYS2_ARG_CONV_EXCL = '*';
process.env.NODE_OPTIONS = '... --max-old-space-size=32768';
```

**Purpose:** Sets environment variables to prevent MSYS path conversion issues and allocate 32GB heap.

**Risk:** None. Standard environment variable configuration.

#### Setup 2: `setupGitPath()`

```javascript
const pathParts = process.env.PATH.split(';')
  .filter(p => !(p.includes('scoop') && p.includes('git')));
process.env.PATH = ['C:\\Program Files\\Git\\cmd', ...pathParts].join(';');
```

**Purpose:** Prefers Program Files Git over Scoop Git (known compatibility issues).

**Risk:** None. Only modifies PATH within the process.

#### Setup 3: `loadApiTokensFromRegistry()`

```javascript
execSync(`reg query "HKCU\\Environment" /v ${token}`, ...);
process.env[token] = match[1].trim();
```

**Purpose:** Loads user-configured API tokens from Windows Registry.

**Risk:** Low. Only reads tokens that the user has explicitly set. Does not write to registry.

#### Setup 4: `setupMcpModules()`

```javascript
fs.mkdirSync(path.join(os.homedir(), '.claude', 'mcp_modules'), { recursive: true });
process.env.MCP_MODULES_PATH = mcpDir;
```

**Purpose:** Creates MCP modules directory and sets environment variable.

**Risk:** Low. Creates directory in user's home folder only.

#### Setup 5: `handleWslPath()`

```javascript
if (cwd.match(/^\\\\wsl/)) {
  spawnSync('wsl', ['-d', distro, '--cd', wslPath, '--', 'claude'], { stdio: 'inherit' });
  process.exit(result.status);
}
```

**Purpose:** Redirects to WSL if current directory is a WSL path.

**Risk:** Low. Only spawns `wsl` with user-visible arguments.

#### Setup 6: `runWithAutoRestart()` with Network Detection

```javascript
// Network connectivity check (DNS only - no HTTP)
async function checkConnectivity() {
  try {
    await dnsLookup('api.anthropic.com');
    return true;
  } catch (err) {
    return false;
  }
}

// Detects network errors by code (ENOTFOUND, ETIMEDOUT, etc.)
function isNetworkError(err) { ... }

// Exponential backoff: 5s, 10s, 20s, 40s, 60s max
async function waitForConnectivity() { ... }

// Main restart loop
while (true) {
  try {
    await import(cliPath);
    break;
  } catch (err) {
    if (isNetworkError(err)) {
      await waitForConnectivity();  // Max 10 retries
      continue;  // Doesn't count against crash limit
    }
    // Regular crash handling (max 3 per minute)
    if (crashRestartCount >= MAX_CRASH_RESTARTS) process.exit(1);
    crashRestartCount++;
    await new Promise(r => setTimeout(r, 1000));
  }
}
```

**Purpose:** Auto-restarts on crash with separate handling for network issues.

**Risk:** Low. The only network operation is a DNS lookup (not HTTP) to verify connectivity. No data is sent or received beyond the DNS query itself.

### runner.js - Node.js Hooks

The wrapper hooks 5 Node.js functions:

#### Hook 1: `fs.accessSync`

**Purpose:** Returns `true` for `/bin/bash` checks.

**Risk:** None. Only affects the `/bin/bash` existence check.

#### Hook 2: `os.tmpdir`

**Purpose:** Converts Windows temp paths to POSIX format.

**Risk:** None. Only transforms path format.

#### Hook 3: `child_process.spawn`

**Purpose:** Redirects `/bin/bash` calls to Git Bash.

**Risk:** None. Only redirects to legitimate Git installation.

#### Hook 4: `process.kill` (EPERM Fix)

**Purpose:** Catches EPERM errors and uses Windows `taskkill` as fallback.

**Risk:** Low. Uses standard Windows process termination.

#### Hook 5: `ChildProcess.prototype.kill` (EPERM Fix)

**Purpose:** Same as Hook 4 for child processes.

**Risk:** Low. Same analysis as Hook 4.

## Dependency Analysis

### Runtime Dependencies

**None.** This package has zero npm dependencies.

### Peer Dependencies

- `@anthropic-ai/claude-code`: The official Anthropic CLI (trusted)

## Data Flow

```
User runs claude-code-win-v2
         │
         ▼
    Setup functions run
    (env vars, PATH, tokens from registry)
         │
         ▼
    Hooks installed (5 functions)
         │
         ▼
    Official Claude Code CLI loaded
         │
         ▼
    Auto-restart wrapper monitors for crashes
         │
         ▼
    All communication goes through
    official Anthropic channels
```

**No data is intercepted, logged, or exfiltrated.**

## Network Analysis

This wrapper makes **one type of network call**: a DNS lookup to `api.anthropic.com` for connectivity checking.

**What the DNS lookup does:**
- Queries your DNS resolver for the IP address of `api.anthropic.com`
- No HTTP/HTTPS connections are made
- No data payload is sent
- Used only to verify internet connectivity before retrying

**When it runs:**
- Only after a network-related error is detected
- During the exponential backoff retry loop
- Not during normal operation

All actual API communication is handled by the official `@anthropic-ai/claude-code` package.

## File System Analysis

This wrapper:
- **Reads:** npm global root location, Git installation path, Windows Registry (tokens)
- **Writes:** Creates `~/.claude/mcp_modules` directory only
- **Executes:** `npm root -g`, `reg query`, `taskkill`, `wsl` (all Windows/system commands)

## Verification Steps

To verify this audit yourself:

1. **Read the source code** - It's ~430 lines of JavaScript
2. **Check for network calls** - Search for `http`, `https`, `fetch`, `request`
3. **Check for file writes** - Search for `writeFile`, `appendFile`, `createWriteStream`
4. **Check dependencies** - `package.json` has no runtime dependencies

```bash
# Verify no dependencies
cat package.json | grep dependencies

# Search for suspicious patterns
grep -r "http\|fetch\|request\|writeFile" runner.js
```

## Feature Summary

| Feature | What It Does | Risk |
|---------|--------------|------|
| Environment setup | Sets MSYS_NO_PATHCONV, NODE_OPTIONS | None |
| Git PATH fix | Prefers Program Files Git | None |
| Token loading | Reads from Windows Registry | Low |
| MCP directory | Creates ~/.claude/mcp_modules | Low |
| WSL detection | Redirects to WSL | Low |
| Auto-restart | Restarts on crash (max 3/min) | None |
| Network retry | DNS lookup for connectivity check | Low |
| Hook 1-3 | Path/bash compatibility | None |
| Hook 4-5 | EPERM crash fix | Low |

## Conclusion

This wrapper is safe to use. It:
- Only hooks necessary functions for Windows compatibility
- Uses standard Windows tools (taskkill, reg query, wsl)
- Has no dependencies that could be compromised
- Only makes DNS lookups for connectivity checking (no HTTP/data transfer)
- Only reads user-configured tokens from registry
- Creates one directory in user's home folder

The code is fully auditable and all functionality is documented.

---

*Last audited: November 2025*
*Auditor: Claude (Anthropic)*
