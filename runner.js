#!/usr/bin/env node
/**
 * wclaude - Windows wrapper for Claude Code
 *
 * Based on win-claude-code by somersby10ml (MIT License)
 * Enhanced with:
 * - EPERM crash fix for Windows process termination
 * - Environment setup (MSYS, NODE_OPTIONS)
 * - API token loading from Windows Registry
 * - WSL path detection and redirection
 * - MCP module directory setup
 * - Auto-restart on crash (with loop prevention)
 * - Auto-approve permissions (native JavaScript, no PowerShell)
 *
 * Hooks:
 * 1. fs.accessSync - Fake /bin/bash existence
 * 2. os.tmpdir - Convert Windows paths to POSIX
 * 3. child_process.spawn - Redirect /bin/bash to Git Bash, intercept hooks
 * 4. process.kill - Catch EPERM, use taskkill fallback
 * 5. ChildProcess.prototype.kill - Catch EPERM
 * 6. child_process.execSync - Intercept cygpath, use windowsToPosix
 * 7. fs.readFileSync - Inject PermissionRequest hook into settings
 */

import { execSync, spawn, spawnSync, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import { syncBuiltinESMExports, createRequire } from 'module';
import os from 'os';
import dns from 'dns';
import { promisify } from 'util';
import { EventEmitter } from 'events';
import { fileURLToPath } from 'url';
import notifier from 'node-notifier';
import { validateCommand } from './blocklist.js';

// ES modules equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path to Claude icon for toast notifications
const CLAUDE_ICON_PATH = path.join(__dirname, 'assets', 'claude-icon.png');

const dnsLookup = promisify(dns.lookup);

// ============================================
// DEBUG MODE (must be before exported functions that use logger)
// ============================================

const DEBUG_MODE = process.argv.includes('--windebug');

// Remove --windebug from argv so Claude Code's CLI doesn't see it
if (DEBUG_MODE) {
  const idx = process.argv.indexOf('--windebug');
  if (idx !== -1) {
    process.argv.splice(idx, 1);
  }
}

// Debug log file path (writes to ~/.claude/debug.log when --debug is enabled)
const DEBUG_LOG_PATH = DEBUG_MODE ? path.join(os.homedir(), '.claude', 'debug.log') : null;

// Initialize debug log file
if (DEBUG_LOG_PATH) {
  try {
    const timestamp = new Date().toISOString();
    fs.writeFileSync(DEBUG_LOG_PATH, `\n=== wclaude debug log started at ${timestamp} ===\n`, { flag: 'a' });
  } catch (e) {
    // Ignore - debug logging is best-effort
  }
}

const originalConsole = {
  error: console.error.bind(console),
  warn: console.warn.bind(console),
  log: console.log.bind(console)
};

const logger = {
  error: originalConsole.error,
  warn: originalConsole.warn,
  log: originalConsole.log,
  debug: (...args) => {
    if (DEBUG_MODE && DEBUG_LOG_PATH) {
      try {
        const timestamp = new Date().toISOString();
        const message = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
        fs.appendFileSync(DEBUG_LOG_PATH, `[${timestamp}] ${message}\n`);
      } catch (e) {
        // Ignore - debug logging is best-effort
      }
    }
  }
};

// ============================================
// EXPORTED FUNCTIONS (for testing)
// ============================================

/**
 * Configuration constants
 */
export const CONFIG = {
  MAX_CRASH_RESTARTS: 3,
  CRASH_WINDOW_MS: 60000,
  MAX_NETWORK_RETRIES: 10,
  NETWORK_CHECK_HOST: 'api.anthropic.com',
  NETWORK_BACKOFF_BASE_MS: 5000,
  NETWORK_BACKOFF_MAX_MS: 60000
};

/**
 * Convert Windows path to POSIX format
 * @param {string} windowsPath - Windows path (e.g., C:\Users\johan)
 * @returns {string} POSIX path (e.g., /c/Users/johan)
 */
export function windowsToPosix(windowsPath) {
  return windowsPath
    .replace(/\\/g, '/')
    .replace(/^([A-Z]):/i, '/$1')
    .replace(/^\/[A-Z]/i, match => match.toLowerCase());
}

/**
 * Calculate exponential backoff delay
 * @param {number} attempt - Current attempt number (1-based)
 * @param {number} baseMs - Base delay in milliseconds
 * @param {number} maxMs - Maximum delay in milliseconds
 * @returns {number} Delay in milliseconds
 */
export function calculateBackoff(attempt, baseMs, maxMs) {
  return Math.min(baseMs * Math.pow(2, attempt - 1), maxMs);
}

/**
 * Determine if an error is network-related
 * @param {Error} err - The error to check
 * @returns {boolean} true if network-related
 */
export function isNetworkError(err) {
  if (!err) return false;

  const networkErrorCodes = [
    'ENOTFOUND', 'ETIMEDOUT', 'ECONNREFUSED', 'ECONNRESET',
    'ENETUNREACH', 'EAI_AGAIN', 'EHOSTUNREACH', 'EPIPE'
  ];
  const networkErrorMessages = [
    'network', 'fetch failed', 'socket hang up', 'ENOTFOUND',
    'ETIMEDOUT', 'getaddrinfo', 'connect ECONNREFUSED'
  ];

  if (err.code && networkErrorCodes.includes(err.code)) {
    return true;
  }
  const message = (err.message || '').toLowerCase();
  return networkErrorMessages.some(pattern =>
    message.includes(pattern.toLowerCase())
  );
}

/**
 * Parse command line arguments
 * @param {string[]} args - process.argv array
 * @returns {object} Parsed flags
 */
export function parseArgs(args) {
  return {
    debug: args.includes('--windebug'),
    help: args.includes('--help') || args.includes('-h'),
    version: args.includes('--version') || args.includes('-v')
  };
}

// Re-export validateCommand as validateBashCommand for backward compatibility
// The actual implementation is now in blocklist.js
export { validateCommand as validateBashCommand } from './blocklist.js';

/**
 * Handle PermissionRequest hook - auto-approve most tools
 * @param {string} jsonInput - JSON string with tool_name, tool_input, etc.
 * @returns {string} JSON response for Claude Code
 */
export function handlePermissionRequest(jsonInput) {
  try {
    const request = JSON.parse(jsonInput);
    const toolName = request.tool_name;

    logger.debug('PermissionRequest for tool:', toolName);

    // Tools that require user interaction - don't auto-approve
    const excludedTools = ['AskUserQuestion', 'ExitPlanMode'];

    if (excludedTools.includes(toolName)) {
      // Show toast notification so user knows action is required
      const projectFolder = request.cwd ? path.basename(request.cwd) : 'Unknown';

      // Format: "ProjectName - User Input Required" as title, tool name as message
      const title = `${projectFolder} - Input Required`;
      const message = toolName === 'AskUserQuestion'
        ? 'Claude is asking a question'
        : toolName === 'ExitPlanMode'
          ? 'Plan ready for review'
          : `${toolName} needs approval`;

      logger.debug('Tool excluded, showing notification:', toolName, 'in', projectFolder);
      notifier.notify({
        title,
        message,
        icon: CLAUDE_ICON_PATH,
        sound: true,
        appID: 'Claude Code'  // App name shown in notification
      });

      // Return empty string - Claude Code will show normal prompt (passthrough)
      return '';
    }

    // Auto-approve all other tools
    logger.debug('Auto-approving tool:', toolName);
    return JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PermissionRequest',
        decision: { behavior: 'allow' }
      }
    });
  } catch (e) {
    // Fail-open: approve on error to avoid blocking the session
    logger.debug('PermissionRequest error, failing open:', e.message);
    return JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PermissionRequest',
        decision: { behavior: 'allow' }
      }
    });
  }
}

/**
 * Handle Stop hook - show Windows toast notification
 * @param {string} jsonInput - JSON string with hook data
 * @returns {string} JSON response for Claude Code
 */
export function handleStopHook(jsonInput) {
  // Try to get project name from the hook input
  let projectFolder = 'Claude Code';
  try {
    const request = JSON.parse(jsonInput);
    if (request.cwd) {
      projectFolder = path.basename(request.cwd);
    }
  } catch (e) {
    // Ignore parse errors, use default
  }

  // Show notification (non-blocking)
  notifier.notify({
    title: `${projectFolder} - Task Complete`,
    message: 'Claude has finished the task',
    icon: CLAUDE_ICON_PATH,
    sound: true,
    appID: 'Claude Code'  // App name shown in notification
  });

  return JSON.stringify({});
}

// Track child processes for clean shutdown
const childProcesses = new Set();

/**
 * Setup signal handlers for clean Ctrl+C shutdown
 */
function setupSignalHandlers() {
  // Kill child processes only (for unfreezing)
  const killChildren = (signal) => {
    const count = childProcesses.size;
    if (count === 0) {
      originalConsole.log(`\n[wclaude] ${signal} - no child processes to kill`);
      return;
    }

    originalConsole.log(`\n[wclaude] ${signal} - killing ${count} child process(es)...`);

    for (const child of childProcesses) {
      if (child.pid) {
        try {
          execSync(`taskkill /T /F /PID ${child.pid}`, {
            stdio: 'ignore',
            timeout: 3000
          });
        } catch (e) {
          // Process already dead - ignore
        }
      }
    }
    childProcesses.clear();
  };

  // Full cleanup and exit
  const cleanupAndExit = (signal) => {
    originalConsole.log(`\n[wclaude] Received ${signal}, shutting down...`);
    killChildren(signal);

    // Force exit after a short delay
    setTimeout(() => {
      process.exit(0);
    }, 100);
  };

  // Handle Ctrl+C (SIGINT) and terminal close (SIGTERM)
  process.on('SIGINT', () => cleanupAndExit('SIGINT'));
  process.on('SIGTERM', () => cleanupAndExit('SIGTERM'));

  // Windows-specific: handle console close events and Ctrl+Break
  if (process.platform === 'win32') {
    process.on('SIGHUP', () => cleanupAndExit('SIGHUP'));
    // Ctrl+Break: kill children only, don't exit - allows unfreezing without closing
    process.on('SIGBREAK', () => killChildren('SIGBREAK'));
  }

  logger.debug('Signal handlers installed (SIGINT, SIGTERM, SIGHUP, SIGBREAK)');
}

// Counters (configuration is in exported CONFIG object)
let crashRestartCount = 0;
let lastCrashTime = 0;
let networkRetryCount = 0;

(async () => {
  // ============================================
  // SETUP: Run before anything else
  // ============================================
  setupSignalHandlers();  // Enable clean Ctrl+C shutdown
  setupEnvironment();
  setupGitPath();
  loadApiTokensFromRegistry();
  setupMcpModules();
  handleWslPath(); // May exit if WSL path detected

  let gitBashPath = null;

  /**
   * Setup environment variables for Windows compatibility
   */
  function setupEnvironment() {
    // Prevent MSYS/Git Bash path conversion issues
    process.env.MSYS_NO_PATHCONV = '1';
    process.env.MSYS2_ARG_CONV_EXCL = '*';
    process.env.MSYS_PATH_CONVERT_DISABLE = '1';

    // Allocate heap based on system memory (75% of RAM, capped at 32GB)
    // Only add if not already set (allow user override)
    if (!process.env.NODE_OPTIONS?.includes('max-old-space-size')) {
      const totalMemoryMB = Math.floor(os.totalmem() / (1024 * 1024));
      const heapSizeMB = Math.min(Math.floor(totalMemoryMB * 0.75), 32768);
      process.env.NODE_OPTIONS = ((process.env.NODE_OPTIONS || '') + ` --max-old-space-size=${heapSizeMB}`).trim();
    }

    // Extract heap size for logging
    const heapMatch = process.env.NODE_OPTIONS?.match(/--max-old-space-size=(\d+)/);
    const heapSizeGB = heapMatch ? (parseInt(heapMatch[1], 10) / 1024).toFixed(1) + 'GB' : 'default';

    logger.debug('Environment configured:', {
      MSYS_NO_PATHCONV: process.env.MSYS_NO_PATHCONV,
      MSYS_PATH_CONVERT_DISABLE: process.env.MSYS_PATH_CONVERT_DISABLE,
      NODE_OPTIONS: heapSizeGB + ' heap'
    });
  }

  /**
   * Setup PATH to prefer Program Files Git over Scoop Git
   * (Scoop Git has known issues with Claude Code)
   */
  function setupGitPath() {
    const programFilesGit = 'C:\\Program Files\\Git\\cmd';
    if (fs.existsSync(programFilesGit)) {
      // Remove Scoop Git from PATH, prepend Program Files Git
      const pathParts = (process.env.PATH || '').split(';')
        .filter(p => !(p.toLowerCase().includes('scoop') && p.toLowerCase().includes('git')));
      process.env.PATH = [programFilesGit, ...pathParts].join(';');
      logger.debug('Git PATH: Program Files Git prepended');
    } else {
      logger.debug('Git PATH: unchanged (Program Files Git not found)');
    }
  }

  /**
   * Load API tokens from Windows Registry if not already in environment
   */
  function loadApiTokensFromRegistry() {
    const tokens = [
      'ANTHROPIC_API_KEY',
      'GITHUB_TOKEN',
      'BRAVE_API_KEY',
      'EXA_API_KEY',
      'PERPLEXITY_API_KEY'
    ];

    const loaded = [];

    for (const token of tokens) {
      if (process.env[token]) continue; // Already set

      // Try User environment first, then Machine
      const hives = [
        'HKCU\\Environment',
        'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment'
      ];

      for (const hive of hives) {
        try {
          const result = execSync(`reg query "${hive}" /v ${token}`, {
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'ignore'],
            timeout: 5000
          });
          const match = result.match(/REG_(?:SZ|EXPAND_SZ)\s+(.+)/);
          if (match) {
            process.env[token] = match[1].trim();
            loaded.push(token);
            break;
          }
        } catch (e) {
          // Token not found in this hive - continue
        }
      }
    }

    logger.debug('API tokens loaded from registry:', loaded.length > 0 ? loaded : 'none');
  }

  /**
   * Setup MCP modules directory junction
   * Creates a junction from ~/.mcp-modules/node_modules/@anthropic-ai/claude-code
   * to the npm global installation, allowing MCP servers to find Claude Code modules.
   */
  function setupMcpModules() {
    let npmGlobalRoot;
    try {
      npmGlobalRoot = execSync('npm root -g', { encoding: 'utf8', timeout: 10000 }).trim();
    } catch (e) {
      logger.debug('MCP junction skipped: could not get npm root');
      return;
    }

    // Target: npm global @anthropic-ai/claude-code
    const target = path.join(npmGlobalRoot, '@anthropic-ai', 'claude-code');

    if (!fs.existsSync(target)) {
      logger.debug('MCP junction skipped: claude-code not found at', target);
      return;
    }

    // Link location: ~/.mcp-modules/node_modules/@anthropic-ai/claude-code
    const mcpBase = path.join(os.homedir(), '.mcp-modules', 'node_modules', '@anthropic-ai');
    const linkPath = path.join(mcpBase, 'claude-code');

    // Skip if anything already exists at link path
    // NEVER delete user data - if something exists, leave it alone
    if (fs.existsSync(linkPath)) {
      try {
        const stat = fs.lstatSync(linkPath);
        if (stat.isSymbolicLink()) {
          logger.debug('MCP junction already exists:', linkPath);
        } else {
          logger.debug('MCP junction skipped: path exists and is not a junction:', linkPath);
        }
      } catch (e) {
        logger.debug('MCP junction skipped: could not stat path:', linkPath);
      }
      return;
    }

    // Create parent directories
    try {
      fs.mkdirSync(mcpBase, { recursive: true });
    } catch (e) {
      logger.debug('MCP junction skipped: could not create parent directories:', e.message);
      return;
    }

    // Create junction (Windows directory link)
    try {
      fs.symlinkSync(target, linkPath, 'junction');
      logger.debug('MCP junction created:', linkPath, '->', target);
    } catch (e) {
      // Non-fatal - MCP will still work, just won't find modules at expected path
      logger.debug('MCP junction skipped: could not create junction:', e.message);
    }
  }

  /**
   * Handle WSL paths - redirect to WSL if current directory is a WSL path
   */
  function handleWslPath() {
    let cwd;
    try {
      cwd = process.cwd();
    } catch (e) {
      return; // Can't get CWD - skip WSL detection
    }

    // Match WSL UNC paths: \\wsl$\Ubuntu\... or \\wsl.localhost\Ubuntu\...
    const wslMatch = cwd.match(/^\\\\wsl(\$|\.localhost)\\([^\\]+)(.*)/i);

    if (wslMatch) {
      const distro = wslMatch[2];
      const wslPath = wslMatch[3].replace(/\\/g, '/') || '/';

      originalConsole.log(`[wclaude] WSL path detected, launching in ${distro}: ${wslPath}`);

      const result = spawnSync('wsl', ['-d', distro, '--cd', wslPath, '--', 'claude'], {
        stdio: 'inherit'
      });

      process.exit(result.status || 0);
    }
  }

  /**
   * Check if internet is available by performing DNS lookup
   * @returns {Promise<boolean>} true if connected
   */
  async function checkConnectivity() {
    try {
      await dnsLookup(CONFIG.NETWORK_CHECK_HOST);
      return true;
    } catch (err) {
      return false;
    }
  }

  // Note: isNetworkError() is now exported at the top of the file

  /**
   * Wait for internet connectivity with exponential backoff
   * @returns {Promise<boolean>} true if connected, false if max retries exceeded
   */
  async function waitForConnectivity() {
    networkRetryCount = 0;

    while (networkRetryCount < CONFIG.MAX_NETWORK_RETRIES) {
      networkRetryCount++;

      // Exponential backoff: 5s, 10s, 20s, 40s, 60s, 60s, ...
      const backoffMs = calculateBackoff(
        networkRetryCount,
        CONFIG.NETWORK_BACKOFF_BASE_MS,
        CONFIG.NETWORK_BACKOFF_MAX_MS
      );

      originalConsole.warn(
        `[wclaude] No internet connection. ` +
        `Retry ${networkRetryCount}/${CONFIG.MAX_NETWORK_RETRIES} in ${backoffMs / 1000}s...`
      );

      await new Promise(r => setTimeout(r, backoffMs));

      if (await checkConnectivity()) {
        originalConsole.log('[wclaude] Connection restored!');
        networkRetryCount = 0; // Reset for next disconnection
        return true;
      }
    }

    return false; // Max retries exceeded
  }

  /**
   * Run CLI with auto-restart on crash (with loop prevention)
   * Handles network errors separately from regular crashes
   */
  async function runWithAutoRestart(cliPath) {
    while (true) {
      try {
        await import(`file://${cliPath}`);
        break; // Normal exit
      } catch (err) {
        const now = Date.now();

        // Check if this is a network error
        if (isNetworkError(err)) {
          originalConsole.warn('[wclaude] Network error detected:', err.message);

          // Wait for connectivity to be restored
          const connected = await waitForConnectivity();

          if (!connected) {
            originalConsole.error(
              `[wclaude] No internet after ${CONFIG.MAX_NETWORK_RETRIES} retries. Stopping.`
            );
            process.exit(1);
          }

          // Connection restored - restart without counting against crash limit
          continue;
        }

        // Non-network error: use existing crash restart logic
        if (now - lastCrashTime > CONFIG.CRASH_WINDOW_MS) {
          crashRestartCount = 0;
        }

        crashRestartCount++;
        lastCrashTime = now;

        if (crashRestartCount >= CONFIG.MAX_CRASH_RESTARTS) {
          originalConsole.error(
            `[wclaude] Crashed ${CONFIG.MAX_CRASH_RESTARTS} times in ${CONFIG.CRASH_WINDOW_MS / 1000}s. Stopping.`
          );
          originalConsole.error('[wclaude] Error:', err.message);
          process.exit(1);
        }

        originalConsole.warn(
          `[wclaude] Crashed. Restarting... (${crashRestartCount}/${CONFIG.MAX_CRASH_RESTARTS})`
        );

        // Small delay before restart to prevent CPU thrashing
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  }

  async function main() {
    const npmGlobalRoot = await getNpmGlobalRoot();
    const claudePath = path.join(npmGlobalRoot, '@anthropic-ai', 'claude-code');
    const packageInstalled = fs.existsSync(path.join(claudePath, 'package.json'));

    if (!packageInstalled) {
      originalConsole.error('Claude Code package is not installed globally.');
      originalConsole.error('Please run: npm install -g @anthropic-ai/claude-code --ignore-scripts');
      return;
    }

    const cliPath = path.join(claudePath, 'cli.js');
    if (!fs.existsSync(cliPath)) {
      originalConsole.error('CLI script is not found. Please ensure it is installed correctly.');
      return;
    }

    logger.debug('Claude Code path:', cliPath);

    gitBashPath = findGitBashPath();
    if (!gitBashPath) {
      originalConsole.warn('[wclaude] Git Bash not found - Unix commands (grep, find, awk, sed) will not be available');
      originalConsole.warn('[wclaude] To enable Unix commands, install Git for Windows: https://git-scm.com/download/win');
      originalConsole.warn('[wclaude] After installation, restart your terminal and run again');
    }
    logger.debug('Git Bash:', gitBashPath || 'not found');

    hook();

    // Run CLI with auto-restart capability
    await runWithAutoRestart(cliPath);
  }

  const hook = () => {
    // ============================================
    // Hook 1: fs.accessSync - Fake /bin/bash existence
    // ============================================
    const originalAccessSync = fs.accessSync;
    fs.accessSync = function (...args) {
      if (args.length >= 2 && typeof args[0] === 'string' && args[0].includes('/bin/bash') && args[1] === 1) {
        return true;
      }
      return originalAccessSync.apply(this, args);
    };

    // ============================================
    // Hook 2: os.tmpdir - Convert Windows paths to POSIX
    // ============================================
    const originalTmpdir = os.tmpdir;
    os.tmpdir = function () {
      const windowsTmpPath = originalTmpdir.call(this);
      const unixTmpPath = windowsToPosix(windowsTmpPath);
      return unixTmpPath;
    };

    // ============================================
    // Hook 3: child_process.spawn - Redirect to Git Bash, validate commands, track processes
    // ============================================

    /**
     * Create a fake child process that reports a blocked command.
     * Compatible with spawn-rx library expectations (used by Claude Code).
     * @param {string} reason - Why the command was blocked
     * @returns {EventEmitter} Fake child process with stdout/stderr
     */
    const createBlockedChildProcess = (reason) => {
      const child = new EventEmitter();
      child.pid = 0;
      child.killed = false;
      child.stdin = { write: () => {}, end: () => {} };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = () => { child.killed = true; };

      // Emit error to stderr and close with exit code 1 (on next tick to allow event handlers to attach)
      process.nextTick(() => {
        child.stderr.emit('data', Buffer.from(`[blocked] ${reason}\n`));
        child.stdout.emit('close');
        child.stderr.emit('close');
        child.emit('close', 1); // Exit code 1 = failure
      });

      return child;
    };

    /**
     * Create a fake child process that handles hook requests.
     * Reads JSON from stdin, processes with handler, writes response to stdout.
     * Compatible with Claude Code's hook execution.
     *
     * Claude Code hook execution flow (from cli.js):
     * 1. F.stdout.setEncoding("utf8"), F.stderr.setEncoding("utf8")
     * 2. F.stdout.on("data", ...), F.stderr.on("data", ...)
     * 3. F.stdin.on("error", ...), F.stdin.write(data, "utf8"), F.stdin.end()
     * 4. F.on("close", ...) - waits for exit code
     *
     * @param {function} handleFn - Function that takes JSON string and returns JSON response
     * @returns {EventEmitter} Fake child process with stdin/stdout
     */
    const createHookChildProcess = (handleFn) => {
      const child = new EventEmitter();
      child.pid = process.pid;
      child.killed = false;

      // Buffer stdin data and process on end()
      let stdinData = '';

      // stdin needs to be an EventEmitter with write/end methods
      // Claude Code calls: stdin.on("error", cb), stdin.write(data, "utf8"), stdin.end()
      child.stdin = new EventEmitter();
      child.stdin.write = function(chunk, encoding, callback) {
        logger.debug('Hook stdin.write called, chunk length:', chunk?.length);
        if (chunk) stdinData += chunk.toString();
        // Call callback if provided (stream interface)
        if (typeof encoding === 'function') encoding();
        else if (typeof callback === 'function') callback();
        return true; // Indicate write was successful (buffer not full)
      };
      child.stdin.end = function(chunk, encoding, callback) {
        logger.debug('Hook stdin.end called, total data length:', stdinData.length);
        if (chunk) stdinData += chunk.toString();

        logger.debug('Hook processing input:', stdinData.substring(0, 500));
        const response = handleFn(stdinData);
        logger.debug('Hook response:', response.substring(0, 200));

        // Emit response on next tick to allow event handlers to attach
        process.nextTick(() => {
          // Emit data as string (setEncoding was called)
          child.stdout.emit('data', response);
          child.stdout.emit('close');
          child.stderr.emit('close');
          child.emit('close', 0); // Exit code 0 = success
        });

        // Call callback if provided
        if (typeof encoding === 'function') encoding();
        else if (typeof callback === 'function') callback();
      };

      // stdout/stderr need setEncoding method (Claude Code calls this)
      child.stdout = new EventEmitter();
      child.stdout.setEncoding = function(enc) {
        logger.debug('Hook stdout.setEncoding called:', enc);
        return this;
      };

      child.stderr = new EventEmitter();
      child.stderr.setEncoding = function(enc) {
        logger.debug('Hook stderr.setEncoding called:', enc);
        return this;
      };

      child.kill = () => { child.killed = true; };

      return child;
    };

    {
      const originalSpawn = spawn;
      const spawnHook = function (command, args = [], options = {}) {
        try {
          // Check if this is our injected hook being spawned
          if (typeof command === 'string' && command.includes('__RUNNER_PERMISSION_HOOK__')) {
            logger.debug('Intercepting injected PermissionRequest hook');
            return createHookChildProcess(handlePermissionRequest);
          }
          // Also check args for cases where command is 'node' and args contain the marker
          if (command === 'node' && Array.isArray(args) && args.some(a => String(a).includes('__RUNNER_PERMISSION_HOOK__'))) {
            logger.debug('Intercepting injected PermissionRequest hook (args)');
            return createHookChildProcess(handlePermissionRequest);
          }

          if (command === '/bin/bash' && gitBashPath) {
            // Validate bash -c commands before execution
            if (args[0] === '-c' && args[1]) {
              const validation = validateBashCommand(args[1]);
              if (!validation.allowed) {
                logger.debug('Command blocked:', { command: args[1], reason: validation.reason });
                return createBlockedChildProcess(validation.reason);
              }
            }
            command = gitBashPath;
          }
          const child = originalSpawn.call(this, command, args, options);

          // Track child process for clean shutdown on Ctrl+C
          if (child && child.pid) {
            childProcesses.add(child);
            child.on('exit', () => {
              childProcesses.delete(child);
            });
            child.on('error', () => {
              childProcesses.delete(child);
            });
          }

          return child;
        } catch (error) {
          originalConsole.error('[wclaude] spawn error:', error);
          throw error;
        }
      };

      try {
        const require = createRequire(import.meta.url);
        const childProcess = require('child_process');

        if (childProcess && childProcess.spawn) {
          childProcess.spawn = spawnHook;
        }

        if (typeof global !== 'undefined') {
          global.spawn = spawnHook;
        }
      } catch (e) {
        originalConsole.warn('[wclaude] Could not hook spawn function:', e.message);
      }
    }

    // ============================================
    // Hook 4: process.kill - EPERM crash prevention
    // ============================================
    const originalProcessKill = process.kill.bind(process);
    process.kill = function (pid, signal) {
      try {
        return originalProcessKill(pid, signal);
      } catch (err) {
        if (err.code === 'EPERM') {
          // Windows ACCESS_DENIED - use taskkill fallback
          try {
            execSync(`taskkill /T /F /PID ${pid}`, {
              stdio: 'ignore',
              timeout: 5000
            });
            return undefined; // Match original process.kill() return value
          } catch (taskKillErr) {
            // Process already dead or inaccessible - treat as success
            return undefined;
          }
        }
        if (err.code === 'ESRCH') {
          // Process already dead - this is fine
          return undefined;
        }
        throw err;
      }
    };

    // ============================================
    // Hook 5: ChildProcess.prototype.kill - EPERM crash prevention
    // ============================================
    const originalChildProcessKill = ChildProcess.prototype.kill;
    ChildProcess.prototype.kill = function (signal) {
      try {
        return originalChildProcessKill.call(this, signal);
      } catch (err) {
        if (err.code === 'EPERM' || err.code === 'ESRCH') {
          // Try taskkill if we have a PID
          if (this.pid) {
            try {
              execSync(`taskkill /T /F /PID ${this.pid}`, {
                stdio: 'ignore',
                timeout: 5000
              });
            } catch (taskKillErr) {
              // Ignore - process is dead or inaccessible
            }
          }
          return undefined; // Match original ChildProcess.kill() return value
        }
        throw err;
      }
    };

    // ============================================
    // Hook 6: execSync - Intercept cygpath calls
    // ============================================
    // Claude Code internally calls cygpath to convert Windows paths.
    // This fails on Git Bash/MSYS (cygpath only exists in Cygwin) and
    // crashes on malformed paths (embedded \r, unbalanced quotes, etc.)
    // This hook intercepts cygpath calls and handles them with windowsToPosix.
    {
      const require = createRequire(import.meta.url);
      const childProcess = require('child_process');
      const originalExecSync = childProcess.execSync;

      childProcess.execSync = function (command, options) {
        // Intercept cygpath -u calls
        if (typeof command === 'string' && command.startsWith('cygpath -u')) {
          // Extract the path from: cygpath -u 'C:\path\to\file'
          const match = command.match(/cygpath\s+-u\s+['"]?(.+?)['"]?\s*$/);
          if (match) {
            let windowsPath = match[1];
            // Sanitize: remove carriage returns, newlines, trim quotes
            windowsPath = windowsPath.replace(/[\r\n]/g, '').replace(/^['"]|['"]$/g, '');
            // Convert using our function
            const posixPath = windowsToPosix(windowsPath);
            logger.debug('cygpath intercepted:', { from: windowsPath, to: posixPath });
            return posixPath;
          }
        }
        // Pass through all other commands
        return originalExecSync.call(this, command, options);
      };
    }

    // ============================================
    // Hook 7: fs.readFileSync - Inject PermissionRequest hook into settings
    // ============================================
    // Claude Code reads settings.json to get hook configurations.
    // Instead of requiring hooks in settings.json, we inject our hook
    // configuration dynamically. This allows us to:
    // 1. Auto-approve most tools without user intervention
    // 2. Still require user approval for AskUserQuestion and ExitPlanMode
    // 3. Show toast notifications when user approval is needed
    {
      const settingsPath = path.join(os.homedir(), '.claude', 'settings.json').replace(/\\/g, '/');
      const originalReadFileSync = fs.readFileSync;

      fs.readFileSync = function (filePath, options) {
        const result = originalReadFileSync.call(this, filePath, options);

        // Only intercept settings.json reads
        const normalizedPath = String(filePath).replace(/\\/g, '/');
        if (!normalizedPath.includes('.claude/settings.json') && !normalizedPath.includes('.claude\\settings.json')) {
          return result;
        }

        try {
          // Parse the settings and inject our hooks
          const content = typeof result === 'string' ? result : result.toString('utf8');
          const settings = JSON.parse(content);

          // Only inject if hooks section doesn't already have PermissionRequest
          if (!settings.hooks?.PermissionRequest?.length) {
            settings.hooks = settings.hooks || {};

            // Inject PermissionRequest hook - points to a placeholder script
            // The actual handling is done in Hook 3 (spawn) which intercepts this
            settings.hooks.PermissionRequest = [{
              hooks: [{
                type: 'command',
                command: 'node -e "__RUNNER_PERMISSION_HOOK__"'
              }]
            }];

            logger.debug('Injected PermissionRequest hook into settings');
          }

          // Return modified settings as string or buffer
          const modifiedContent = JSON.stringify(settings, null, 2);
          return typeof result === 'string' ? modifiedContent : Buffer.from(modifiedContent);
        } catch (e) {
          // If parsing fails, return original content
          logger.debug('Could not inject hooks into settings:', e.message);
          return result;
        }
      };
    }

    try {
      syncBuiltinESMExports();
    } catch (e) {
      // Silently ignore sync errors - not critical for operation
    }

    logger.debug('Hooks applied:', {
      fsAccessSync: true,
      osTmpdir: true,
      spawn: !!gitBashPath,
      commandValidation: !!gitBashPath,
      processKill: true,
      childProcessKill: true,
      execSync: true,
      fsReadFileSync: true,
      autoApprovePermissions: true
    });
  };

  /**
   * Find Git Bash installation path
   */
  const findGitBashPath = () => {
    const possibleGitPaths = [
      'C:/Program Files/Git/usr/bin/bash.exe',
      'C:/Program Files (x86)/Git/usr/bin/bash.exe',
      // Also check common custom install locations
      'D:/Program Files/Git/usr/bin/bash.exe',
      'D:/Git/usr/bin/bash.exe',
    ];

    for (const gitPath of possibleGitPaths) {
      if (fs.existsSync(gitPath)) {
        return gitPath;
      }
    }

    // Try to find via where command
    try {
      const result = execSync('where git', { encoding: 'utf8', timeout: 5000 });
      const gitExePath = result.trim().split('\n')[0];
      if (gitExePath) {
        // Git is usually at Git/cmd/git.exe, bash is at Git/usr/bin/bash.exe
        const gitDir = path.dirname(path.dirname(gitExePath));
        const bashPath = path.join(gitDir, 'usr', 'bin', 'bash.exe').replace(/\\/g, '/');
        if (fs.existsSync(bashPath)) {
          return bashPath;
        }
      }
    } catch (e) {
      // Git not found in PATH
    }

    return false;
  };

  // Note: windowsToPosix() is now exported at the top of the file

  /**
   * Get npm global root directory
   */
  const getNpmGlobalRoot = () => {
    try {
      const result = execSync('npm root -g', {
        encoding: 'utf8',
        timeout: 10000
      });

      const rootPath = result.trim();

      if (!rootPath) {
        throw new Error('npm root -g returned empty result');
      }

      return rootPath;
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new Error('npm command not found. Please ensure npm is installed and available in PATH');
      }

      if (error.signal === 'SIGTERM') {
        throw new Error('npm root -g command timed out');
      }

      throw new Error(`Failed to get npm global root: ${error.message}`);
    }
  };

  main().catch(err => {
    originalConsole.error('Error in main function:', err);
  });

})();
