# wclaude

[![npm version](https://badge.fury.io/js/wclaude.svg)](https://www.npmjs.com/package/wclaude)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A production-ready Windows wrapper for [Claude Code](https://docs.anthropic.com/en/docs/claude-code) that auto-approves tool calls just as fast as `--dangerously-skip-permissions` but with a configurable [`blocklist.js`](blocklist.js) to block dangerous commands. Features **[Windows toast notifications](#auto-approve-permissions)** when user input is needed, and **[Ctrl+Break to unfreeze](#ctrlbreak-unfreeze-feature)** stuck sessions without losing your conversation.

> ⚠️ **Important:** Using the wclaude wrapper is similar to running Claude Code with `--dangerously-skip-permissions`. **You are responsible for reviewing Claude's actions.** We take no responsibility for outcomes when running Claude Code this way.
>
> **Note:** Do not use `--dangerously-skip-permissions` with this wrapper. That flag bypasses Claude Code's permission system entirely, which means our auto-approve hooks and blocklist won't see requests at all. The wrapper already handles permissions just as fast and safer.

## Quick Start

```powershell
# Install Claude Code and this wrapper
npm install -g @anthropic-ai/claude-code --ignore-scripts
npm install -g wclaude

# Run!
wclaude
```

That's it! All features are built-in - no separate launcher needed.

## Features

### Major Features

| Feature | What it does |
|---------|--------------|
| **[Ctrl+Break Unfreeze](#ctrlbreak-unfreeze-feature)** | Kill stuck child processes without closing your session |
| **[Hook Interception](#auto-approve-permissions)** | Auto-approve tools with configurable blocklist ([`blocklist.js`](blocklist.js)) |
| **[Toast Notifications](#auto-approve-permissions)** | Windows alerts when planning is done or user action is needed |

### Minor Features

| Feature | Description | Details |
|---------|-------------|---------|
| EPERM Crash Fix | Prevents crashes on command termination | [→](#nodejs-hooks) |
| Cygpath Fix | Intercepts cygpath for Git Bash/MSYS | [→](#cygpath-errors) |
| Auto-Restart | Restarts on crash (max 3/min) | [→](#auto-restart) |
| Network Auto-Restart | Waits for internet with backoff | [→](#auto-restart) |
| Dynamic Heap | 75% of RAM, max 32GB | [→](#setup-functions-run-on-startup) |
| API Token Loading | Loads from Windows Registry | [→](#api-tokens) |
| Git Bash Integration | Enables Unix commands (grep, find, etc.) | [→](#git-bash-not-found-warning) |
| WSL Detection | Auto-redirects `\\wsl$\...` paths | [→](#setup-functions-run-on-startup) |
| Git PATH Fix | Prefers Program Files Git over Scoop | [→](#git-bash-not-found-warning) |
| MCP Module Junction | Links `~/.mcp-modules` to npm global | [→](#mcp-module-junction) |

## Why This Wrapper?

Claude Code on Windows experiences several issues:

1. **EPERM Crashes** - `process.kill()` fails with ACCESS_DENIED, crashing the session
2. **Cygpath Crashes** - Claude Code calls `cygpath` internally, which doesn't exist on Git Bash/MSYS ([#9883](https://github.com/anthropics/claude-code/issues/9883), [#7528](https://github.com/anthropics/claude-code/issues/7528))
3. **Missing Bash** - Claude Code checks for `/bin/bash` which doesn't exist on Windows
4. **Path Issues** - Windows paths don't work with Unix-style tools
5. **Memory Issues** - Large projects need more heap than the default

This wrapper hooks into Node.js to fix these issues automatically.

## Installation

### From npm (Recommended)

```powershell
# 1. Install Claude Code (skip postinstall scripts that assume Unix)
npm install -g @anthropic-ai/claude-code --ignore-scripts

# 2. Install this wrapper
npm install -g wclaude

# 3. Run!
wclaude
```

### From Source

```powershell
git clone https://github.com/johanclawson/wclaude.git
cd wclaude
npm link
wclaude
```

## Usage

```powershell
# Run Claude Code
wclaude

# Run in specific directory
wclaude /path/to/project

# Continue last session
wclaude --continue

# Run with debug logging (writes to ~/.claude/debug.log)
wclaude --windebug
```

## Keyboard Shortcuts

| Shortcut | Action | Description |
|----------|--------|-------------|
| **Ctrl+C** | Clean exit | Kills all child processes and exits the wrapper |
| **Ctrl+Break** | Unfreeze | Kills stuck child processes but keeps the session running |

### Ctrl+Break "Unfreeze" Feature

If Claude Code gets stuck (e.g., a long-running command hangs), press **Ctrl+Break** to kill all child processes without closing your session. This is useful when:

- A bash command times out but doesn't terminate
- A subprocess becomes unresponsive
- You want to interrupt a stuck operation without losing your conversation

**Note:** On Windows, Ctrl+Break always works even if Ctrl+C is disabled or being caught by a subprocess. The Break key is typically located near Scroll Lock on full keyboards, or accessed via Fn+B or Fn+Pause on laptops.

## Configuration

### API Tokens

Store API tokens in Windows Registry (User environment variables):

```powershell
[Environment]::SetEnvironmentVariable("ANTHROPIC_API_KEY", "your-key", "User")
[Environment]::SetEnvironmentVariable("GITHUB_TOKEN", "your-token", "User")
```

The wrapper automatically loads these tokens on startup.

### Timeout Settings

Add to `~/.claude/settings.json`:

```json
{
  "env": {
    "BASH_DEFAULT_TIMEOUT_MS": "1800000",
    "BASH_MAX_TIMEOUT_MS": "7200000"
  }
}
```

## How It Works

### Setup Functions (run on startup)

| Function | Purpose |
|----------|---------|
| `setupEnvironment()` | Sets MSYS env vars (prevents path mangling), `NODE_OPTIONS` (dynamic heap: 75% RAM, max 32GB) |
| `setupGitPath()` | Prefers Program Files Git over Scoop Git |
| `loadApiTokensFromRegistry()` | Loads API tokens from Windows Registry |
| `setupMcpModules()` | Creates junction for MCP servers (see [MCP Module Junction](#mcp-module-junction)) |
| `handleWslPath()` | Redirects WSL paths to WSL |
| `runWithAutoRestart()` | Auto-restarts on crash (max 3/minute) |

### Node.js Hooks

| Hook | Purpose |
|------|---------|
| `fs.accessSync` | Returns true for `/bin/bash` checks |
| `os.tmpdir` | Converts Windows paths to POSIX format |
| `child_process.spawn` | Redirects `/bin/bash` to Git Bash, intercepts hook commands |
| `process.kill` | Catches EPERM, uses `taskkill` fallback, preserves return semantics |
| `ChildProcess.prototype.kill` | Catches EPERM on child processes, preserves return semantics |
| `child_process.execSync` | Intercepts `cygpath` calls, uses built-in path conversion |
| `fs.readFileSync` | Injects PermissionRequest hook into settings.json dynamically |

### Auto-Restart

The wrapper has two separate restart mechanisms:

**Regular Crashes:**
- Max 3 restarts within a 1-minute window
- If crashes are spaced > 1 minute apart, counter resets
- 1 second delay between restarts
- Clear error message when giving up

**Network Disconnections:**
- Detects network-related errors (ENOTFOUND, ETIMEDOUT, ECONNRESET, etc.)
- Uses DNS lookup to `api.anthropic.com` to check connectivity
- Exponential backoff: 5s → 10s → 20s → 40s → 60s (max)
- Up to 10 retries (~5 minutes total wait time)
- Automatically resumes when connection is restored
- Network retries don't count against the crash limit

### Auto-Approve Permissions

The wrapper implements auto-approve permissions entirely in JavaScript - no external PowerShell scripts or settings.json configuration needed:

**How it works:**
1. `fs.readFileSync` hook injects a PermissionRequest hook into settings.json when Claude Code reads it
2. `spawn` hook intercepts the injected hook command and handles it natively
3. Auto-approves all tools except `AskUserQuestion` and `ExitPlanMode`
4. Shows Windows toast notification when user action is required

**Benefits:**
- No external script dependencies
- No hooks needed in `~/.claude/settings.json`
- ~400-800ms faster than PowerShell-based hooks
- Falls-open on errors to avoid blocking sessions

### MCP Module Junction

MCP (Model Context Protocol) servers expect to find Claude Code modules at `~/.mcp-modules/node_modules/@anthropic-ai/claude-code`. However, npm installs global packages to `%APPDATA%\npm\node_modules`.

The wrapper creates a Windows directory junction to bridge this gap:

```
~/.mcp-modules/node_modules/@anthropic-ai/claude-code  →  %APPDATA%/npm/node_modules/@anthropic-ai/claude-code
```

**Safety:**
- Never deletes existing files or directories
- Skips if path already exists (even if not a junction)
- Non-fatal: MCP still works if junction creation fails

**Debug:** Use `--windebug` to see junction status in `~/.claude/debug.log`

## Optional: PowerShell Launcher

For users who want additional features like interactive restart prompts:

```powershell
.\launchers\claude-code-launcher.bat
```

### Context Menu Integration

Add "Open with Claude Code" to folder right-click menu:

1. Run `.\registry\install-context-menu.reg`
2. Confirm the registry modification
3. Right-click any folder to see the option

To remove: Run `.\registry\uninstall-context-menu.reg`

## Troubleshooting

### "Git Bash not found" warning

Install [Git for Windows](https://git-scm.com/download/win). The wrapper checks:
- `C:\Program Files\Git\usr\bin\bash.exe`
- `C:\Program Files (x86)\Git\usr\bin\bash.exe`

**Note:** Scoop-installed Git may have issues. Prefer the official installer.

### Cygpath errors

If you see errors like `Command failed: cygpath -u '...'`, this wrapper fixes them automatically by intercepting cygpath calls. The fix:
- Intercepts all `cygpath -u` calls before they execute
- Sanitizes paths (removes carriage returns, malformed quotes)
- Converts Windows paths to POSIX using built-in `windowsToPosix()`

This is a known Claude Code bug on Windows ([#9883](https://github.com/anthropics/claude-code/issues/9883), [#7528](https://github.com/anthropics/claude-code/issues/7528)).

To debug cygpath interceptions, run with `--windebug` and check `~/.claude/debug.log` for "cygpath intercepted" entries.

### Crashes persist

1. Check timeout settings in `~/.claude/settings.json`
2. Update to latest version: `npm update -g wclaude`
3. Check for errors in console output

## Requirements

- Windows 10/11
- Node.js 18+
- npm
- Git for Windows (optional but recommended)

## Contributing

### Getting Started

```powershell
# Clone the repository
git clone https://github.com/johanclawson/wclaude.git
cd wclaude

# Install dependencies
npm install

# Link for local development
npm link
```

### Debug Mode

Use the `--windebug` flag to enable debug logging. Logs are written to `~/.claude/debug.log`:

```powershell
# Run with debug logging enabled
wclaude --windebug

# View the debug log after running
Get-Content ~/.claude/debug.log

# Or tail the log in real-time (in a separate terminal)
Get-Content ~/.claude/debug.log -Wait
```

Debug log shows:
- Environment configuration status
- Git PATH modifications
- API tokens loaded from registry
- MCP modules directory setup
- Signal handlers installed
- Hooks applied

Each log entry includes a timestamp for troubleshooting timing issues.

Example hook interception log:
```
[timestamp] Intercepting injected PermissionRequest hook
[timestamp] Hook stdout.setEncoding called: utf8
[timestamp] Hook stderr.setEncoding called: utf8
[timestamp] Hook stdin.write called, chunk length: 585
[timestamp] Hook stdin.end called, total data length: 585
[timestamp] PermissionRequest for tool: Bash
[timestamp] Auto-approving tool: Bash
[timestamp] Hook response: {"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow"}}}
```

### Running Tests

The project uses Jest for testing with ES Modules support:

```powershell
# Run all tests
npm test

# Run tests with coverage
npm run test:coverage

# Run tests in watch mode
npm run test:watch
```

### Test Structure

```
tests/
  utils.test.js       - Tests for windowsToPosix, calculateBackoff, parseArgs, CONFIG
  network.test.js     - Tests for isNetworkError detection
  signals.test.js     - Tests for signal handler configuration
  validation.test.js  - Tests for validateBashCommand and blocklist.js exports
  hooks.test.js       - Tests for hook interception (PermissionRequest, StopHook)
```

### Architecture

The project is split across two main files:

**runner.js** - Main wrapper with hooks and auto-restart logic:
- `CONFIG` - Configuration constants
- `windowsToPosix()` - Path conversion
- `calculateBackoff()` - Exponential backoff calculation
- `isNetworkError()` - Network error detection
- `parseArgs()` - Argument parsing
- `handlePermissionRequest()` / `handleStopHook()` - Hook handlers
- Node.js hooks (fs.accessSync, spawn, process.kill, etc.)
- Auto-restart and signal handling

**blocklist.js** - Command validation rules (easy to update):
- `cygpathRules` - Patterns that crash cygpath (nested quotes, shell expansion, UNC paths)
- `safetyRules` - Patterns that hang sessions (dir /s, find, tree, git --all without limits)
- `config` - Constants (maxPathLength: 260)
- `validateCommand()` / `validateBashCommand()` - Main validation function

### Pull Request Guidelines

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Run tests: `npm test`
4. Commit changes with clear messages
5. Push and create a Pull Request

## Credits

This project combines work from:

- **[somersby10ml/win-claude-code](https://github.com/somersby10ml/win-claude-code)** - Original Node.js hooks (MIT)
- **[aaronvstory/claude-code-windows-setup](https://github.com/aaronvstory/claude-code-windows-setup)** - Launcher concepts
- **[GitHub Issue #9745](https://github.com/anthropics/claude-code/issues/9745)** - EPERM fix approach

See [CREDITS.md](CREDITS.md) for full attribution.

## License

MIT License - see [LICENSE](LICENSE)

## Security

This wrapper only hooks Node.js functions for Windows compatibility. It does not:
- Make network calls
- Exfiltrate data
- Modify files outside normal Claude Code operation

See [SECURITY_AUDIT.md](SECURITY_AUDIT.md) for the full security analysis.
