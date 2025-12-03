# wclaude

Windows wrapper for Claude Code with EPERM crash fix, Git Bash integration, and network auto-restart.

## Publishing

**Only publish to npm when explicitly requested by the user.**

### Commands

```bash
# Bump version (choose one)
npm version patch   # 1.3.0 → 1.3.1 (bug fixes)
npm version minor   # 1.3.0 → 1.4.0 (new features)
npm version major   # 1.3.0 → 2.0.0 (breaking changes)

# Commit and push
git add .
git commit -m "v1.x.x - Description of changes"
git push origin master

# Publish to npm
npm publish
```

### Checklist before publishing

- [ ] Run tests: `npm test`
- [ ] Update version in `package.json`
- [ ] Update `README.md` if features changed
- [ ] Update `SECURITY_AUDIT.md` if security-relevant changes
- [ ] Commit all changes to git
- [ ] Push to GitHub
- [ ] Run `npm publish`

## Development

### Testing

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Watch mode
npm run test:watch
```

### Debug Mode

Use `--windebug` to enable debug logging. Logs are written to `~/.claude/debug.log`:

```bash
# Run with debug logging enabled
npm run debug
# or
node runner.js --windebug
# or
wclaude --windebug

# View the debug log
cat ~/.claude/debug.log

# Tail in real-time (separate terminal)
tail -f ~/.claude/debug.log
```

Note: We use `--windebug` instead of `--debug` to avoid conflicts with Claude's own `--debug` flag.

Log entries include timestamps and show: signal handlers, environment config, Git PATH, API tokens, MCP modules, and hooks applied.

## Keyboard Shortcuts

| Shortcut | Signal | Behavior |
|----------|--------|----------|
| **Ctrl+C** | SIGINT | Clean exit - kills child processes and exits |
| **Ctrl+Break** | SIGBREAK | Unfreeze - kills child processes but keeps session running |

**Ctrl+Break** is useful for unfreezing stuck sessions without losing your conversation.

## Architecture

Main functionality is split across two files:

### runner.js (main wrapper)
- **Exported functions** (for testing): CONFIG, windowsToPosix, calculateBackoff, isNetworkError, parseArgs, handlePermissionRequest, handleStopHook
- **Re-exported from blocklist.js**: validateBashCommand
- **Setup functions** (run on startup): Environment, Git PATH, API tokens, MCP modules, Signal handlers, WSL detection
- **Signal handlers**: SIGINT/SIGTERM (clean exit), SIGBREAK (unfreeze), SIGHUP (console close)
- **Auto-restart**: Crash handling (3/min) + network handling (10 retries with backoff)
- **Node.js hooks**: fs.accessSync, os.tmpdir, spawn (with command validation), process.kill, ChildProcess.kill, execSync

### blocklist.js (command validation rules)
- **cygpathRules** - Array of patterns that crash cygpath (nested quotes, shell expansion, UNC paths)
- **safetyRules** - Array of patterns that hang sessions (dir /s, find, tree, git --all without limits)
- **config** - Configuration constants (maxPathLength: 260)
- **validateCommand()** - Main validation function
- **validateBashCommand** - Alias for backward compatibility

### Node.js Hooks

| Hook | Purpose |
|------|---------|
| `fs.accessSync` | Returns true for `/bin/bash` checks |
| `os.tmpdir` | Converts Windows paths to POSIX format |
| `child_process.spawn` | Redirects `/bin/bash` to Git Bash, validates commands, tracks child processes, intercepts hooks |
| `process.kill` | Catches EPERM, uses `taskkill` fallback, returns `undefined` to match original semantics |
| `ChildProcess.prototype.kill` | Catches EPERM on child processes, returns `undefined` to match original semantics |
| `child_process.execSync` | Intercepts `cygpath -u` calls, uses `windowsToPosix()` instead |
| `fs.readFileSync` | Injects PermissionRequest hook configuration into settings.json reads |

### Claude Code Hook Execution Flow

When Claude Code executes a hook command, it follows this sequence (from cli.js ~line 415000):

1. `F.stdout.setEncoding("utf8")` - Sets encoding on stdout
2. `F.stderr.setEncoding("utf8")` - Sets encoding on stderr
3. `F.stdout.on("data", ...)` - Attaches data listener
4. `F.stdin.on("error", R)` - Attaches error handler
5. `F.stdin.write(G, "utf8")` - Writes JSON input
6. `F.stdin.end()` - Signals end of input
7. `F.on("close", ...)` - Waits for exit code

**Critical requirements for fake child processes:**
- `stdout` and `stderr` must have `setEncoding()` method (returns `this`)
- `stdin` must be an EventEmitter with `write()` and `end()` methods
- `stdin.on("error", cb)` must be supported for error handling
- Response data should be emitted as string (not Buffer) since `setEncoding` was called
- Exit code 0 signals success, non-zero signals failure

### Claude Code Internals (Research Findings)

Claude Code uses the `spawn-rx` library (RxJS wrapper around Node.js spawn) for child process management. Key findings from reverse-engineering `cli.js`:

**spawn-rx expectations:**
- stdout/stderr must be EventEmitters with `.on("data", callback)` and `.on("close", callback)`
- Process events: `.on("close", exitCode)` and `.on("error", err)`
- Non-zero exit code triggers error path with `exitCode` property on the Error object

**Relevant cli.js code (~line 28665):**
```javascript
if (D.stdout) z = new Cm.AsyncSubject, D.stdout.on("data", H("stdout")), D.stdout.on("close", function() {
    z.next(!0), z.complete()
});
D.on("close", function(N) {
    if (N === 0) q.subscribe(function() { return Z.complete() });
    else q.subscribe(function() {
        var R = Error("Failed with exit code: ".concat(N));
        R.exitCode = N, R.code = N, Z.error(R)
    })
})
```

This knowledge enabled us to create fake child processes that are compatible with Claude Code's expectations.

**Kill return value semantics (cli.js line ~29842):**
```javascript
if (A.kill()) Q.isCanceled = !0
```
Original `process.kill()` returns `undefined` on success. Our hooks must also return `undefined` (not `true`) to avoid changing the behavior of cancel detection logic.

### Command Validation (Spawn Hook)

The spawn hook validates bash commands **before execution** to prevent:

1. **Cygpath crash patterns**: nested quotes, unbalanced quotes, shell expansion, UNC paths, paths >260 chars
2. **Dangerous recursive operations**: `dir /s` without file pattern, `find` without `-maxdepth`, `tree` without `-L`, `git --all` without limit

**Why in spawn hook instead of PreToolUse hook:**
- **Faster**: Pure JavaScript (~1ms) vs shell script (50-200ms)
- **Cleaner output**: Short `[blocked] reason` message vs verbose hook output
- **Earlier interception**: Blocks before spawn executes; PreToolUse runs after Claude Code processes the command

**How blocking works:**
```javascript
// Returns fake child process compatible with spawn-rx
const createBlockedChildProcess = (reason) => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  process.nextTick(() => {
    child.stderr.emit('data', Buffer.from(`[blocked] ${reason}\n`));
    child.emit('close', 1); // Exit code 1 = failure
  });
  return child;
};
```

Claude Code sees this as a failed command with a clear error message explaining why and what to do instead.

### Auto-Approve Permissions (Hooks 3 + 7)

The wrapper implements auto-approve permissions natively in JavaScript, eliminating the need for external PowerShell scripts and removing hook configuration from settings.json.

**How it works:**
1. **Hook 7 (fs.readFileSync)**: When Claude Code reads `settings.json`, we intercept and inject a PermissionRequest hook configuration that points to a marker command
2. **Hook 3 (spawn)**: When Claude Code spawns the injected hook command, we intercept and handle it natively
3. Auto-approves all tools except `AskUserQuestion` and `ExitPlanMode`
4. Shows Windows toast notifications via `node-notifier` for tools requiring user interaction

**Response format (must match Claude Code's Zod schema):**
```json
{
  "hookSpecificOutput": {
    "hookEventName": "PermissionRequest",
    "decision": { "behavior": "allow" }
  }
}
```

For passthrough (show normal prompt): return empty string `""`

**Invalid fields:** Do NOT include `ok`, `success`, or other fields not in the schema.

**Benefits:**
- **No external dependencies**: No PowerShell scripts needed
- **No settings.json hooks**: Hook configuration is injected dynamically
- **~400-800ms faster**: No PowerShell startup latency per permission request
- **Debuggable**: Use `--windebug` flag to see interception in action
- **Cross-platform notifications**: node-notifier works on Windows/macOS/Linux

**Dynamic settings injection:**
```javascript
// Hook 7: Intercept settings.json reads
fs.readFileSync = function (filePath, options) {
  const result = originalReadFileSync(filePath, options);
  if (filePath.includes('.claude/settings.json')) {
    const settings = JSON.parse(result);
    // Inject our hook configuration
    settings.hooks.PermissionRequest = [{
      hooks: [{ type: 'command', command: 'node -e "__RUNNER_PERMISSION_HOOK__"' }]
    }];
    return JSON.stringify(settings);
  }
  return result;
};
```

**Fake child process for hook handling:**
```javascript
const createHookChildProcess = (handleFn) => {
  const child = new EventEmitter();
  child.pid = process.pid;
  child.killed = false;

  let stdinData = '';

  child.stdin = new EventEmitter();
  child.stdin.write = (chunk, encoding, callback) => {
    if (chunk) stdinData += chunk.toString();
    if (typeof encoding === 'function') encoding();
    else if (typeof callback === 'function') callback();
    return true;
  };
  child.stdin.end = (chunk, encoding, callback) => {
    if (chunk) stdinData += chunk.toString();
    const response = handleFn(stdinData);
    process.nextTick(() => {
      child.stdout.emit('data', response);  // String, not Buffer
      child.stdout.emit('close');
      child.stderr.emit('close');
      child.emit('close', 0);
    });
    if (typeof encoding === 'function') encoding();
    else if (typeof callback === 'function') callback();
  };

  child.stdout = new EventEmitter();
  child.stdout.setEncoding = (enc) => child.stdout;  // Required!

  child.stderr = new EventEmitter();
  child.stderr.setEncoding = (enc) => child.stderr;  // Required!

  child.kill = () => { child.killed = true; };
  return child;
};
```

**Note:** The hooks section in `~/.claude/settings.json` should NOT contain any PermissionRequest hooks - they will be injected dynamically by the wrapper.

### Cygpath Fix (Hook 6)

Claude Code internally calls `cygpath -u` to convert Windows paths to POSIX. This fails on Git Bash/MSYS because `cygpath` only exists in Cygwin. It also crashes on malformed paths (embedded `\r`, unbalanced quotes).

**Known issues fixed:**
- [#9883](https://github.com/anthropics/claude-code/issues/9883) - MSYS/Git Bash incompatibility
- [#7528](https://github.com/anthropics/claude-code/issues/7528) - Critical bug, forces cygpath
- [#8440](https://github.com/anthropics/claude-code/issues/8440) - CLI crashes with cygpath error

**How the fix works:**
1. Intercepts all `execSync` calls before execution
2. Detects `cygpath -u '...'` commands
3. Extracts and sanitizes the Windows path (removes `\r`, `\n`, trims quotes)
4. Converts using `windowsToPosix()` instead of calling cygpath
5. Returns the converted path directly

This runs **before** Claude Code's cli.js can crash, unlike PreToolUse hooks which run after.

### Dynamic Heap Sizing

The wrapper sets `NODE_OPTIONS` with a heap size based on available system memory:

```javascript
const totalMemoryMB = Math.floor(os.totalmem() / (1024 * 1024));
const heapSizeMB = Math.min(Math.floor(totalMemoryMB * 0.75), 32768);
```

- Uses 75% of system RAM
- Capped at 32GB maximum
- Only applied if user hasn't already set `--max-old-space-size`
- Prevents OOM errors on systems with limited RAM while still allowing large projects

### MCP Module Junction

MCP (Model Context Protocol) servers expect Claude Code modules at `~/.mcp-modules/node_modules/@anthropic-ai/claude-code`. However, npm installs global packages to `%APPDATA%\npm\node_modules`.

The wrapper creates a Windows directory junction to bridge this gap:

```
~/.mcp-modules/node_modules/@anthropic-ai/claude-code  →  %APPDATA%/npm/node_modules/@anthropic-ai/claude-code
```

**Safety:**
- Never deletes existing files/directories
- Skips if path already exists (even if not a junction)
- Non-fatal: MCP still works if junction creation fails

**Debug:** Use `--windebug` to see junction status in `~/.claude/debug.log`

## Key Files

| File | Purpose |
|------|---------|
| `runner.js` | Main wrapper - hooks, auto-restart, signal handling |
| `blocklist.js` | Command validation rules (cygpath, safety checks) |
| `package.json` | npm package config |
| `jest.config.js` | Jest test configuration |
| `tests/` | Unit tests (utils, network, signals, validation, hooks) |
| `README.md` | User documentation |
| `SECURITY_AUDIT.md` | Security analysis |
| `CREDITS.md` | Attribution |
| `assets/` | Static assets (claude-icon.png for notifications) |
| `launchers/` | Optional PowerShell launchers |
| `registry/` | Windows context menu integration |
