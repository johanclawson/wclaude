/**
 * Unit tests for utility functions
 *
 * Tests pure functions exported from runner.js:
 * - windowsToPosix
 * - calculateBackoff
 * - parseArgs
 * - CONFIG
 */

import {
  windowsToPosix,
  calculateBackoff,
  parseArgs,
  CONFIG
} from '../runner.js';

describe('CONFIG', () => {
  test('has expected properties', () => {
    expect(CONFIG).toHaveProperty('MAX_CRASH_RESTARTS');
    expect(CONFIG).toHaveProperty('CRASH_WINDOW_MS');
    expect(CONFIG).toHaveProperty('MAX_NETWORK_RETRIES');
    expect(CONFIG).toHaveProperty('NETWORK_CHECK_HOST');
    expect(CONFIG).toHaveProperty('NETWORK_BACKOFF_BASE_MS');
    expect(CONFIG).toHaveProperty('NETWORK_BACKOFF_MAX_MS');
  });

  test('has sensible default values', () => {
    expect(CONFIG.MAX_CRASH_RESTARTS).toBe(3);
    expect(CONFIG.CRASH_WINDOW_MS).toBe(60000);
    expect(CONFIG.MAX_NETWORK_RETRIES).toBe(10);
    expect(CONFIG.NETWORK_CHECK_HOST).toBe('api.anthropic.com');
    expect(CONFIG.NETWORK_BACKOFF_BASE_MS).toBe(5000);
    expect(CONFIG.NETWORK_BACKOFF_MAX_MS).toBe(60000);
  });
});

describe('windowsToPosix', () => {
  test('converts backslashes to forward slashes', () => {
    expect(windowsToPosix('C:\\Users\\johan')).toBe('/c/Users/johan');
  });

  test('converts drive letter to lowercase', () => {
    expect(windowsToPosix('C:\\temp')).toBe('/c/temp');
    expect(windowsToPosix('D:\\data')).toBe('/d/data');
  });

  test('handles uppercase and lowercase drive letters', () => {
    expect(windowsToPosix('c:\\temp')).toBe('/c/temp');
    expect(windowsToPosix('C:\\temp')).toBe('/c/temp');
  });

  test('handles complex paths', () => {
    expect(windowsToPosix('C:\\Users\\johan\\AppData\\Local\\Temp'))
      .toBe('/c/Users/johan/AppData/Local/Temp');
  });

  test('handles paths with spaces', () => {
    expect(windowsToPosix('C:\\Program Files\\Git'))
      .toBe('/c/Program Files/Git');
  });

  test('handles already-POSIX paths gracefully', () => {
    // Not the primary use case, but should not break
    const posixPath = '/c/Users/johan';
    expect(windowsToPosix(posixPath)).toBe('/c/Users/johan');
  });
});

describe('calculateBackoff', () => {
  test('returns base for first attempt', () => {
    expect(calculateBackoff(1, 5000, 60000)).toBe(5000);
  });

  test('doubles each attempt', () => {
    expect(calculateBackoff(1, 5000, 60000)).toBe(5000);
    expect(calculateBackoff(2, 5000, 60000)).toBe(10000);
    expect(calculateBackoff(3, 5000, 60000)).toBe(20000);
    expect(calculateBackoff(4, 5000, 60000)).toBe(40000);
  });

  test('caps at maximum', () => {
    expect(calculateBackoff(5, 5000, 60000)).toBe(60000);
    expect(calculateBackoff(6, 5000, 60000)).toBe(60000);
    expect(calculateBackoff(10, 5000, 60000)).toBe(60000);
  });

  test('works with different base values', () => {
    expect(calculateBackoff(1, 1000, 10000)).toBe(1000);
    expect(calculateBackoff(2, 1000, 10000)).toBe(2000);
    expect(calculateBackoff(3, 1000, 10000)).toBe(4000);
    expect(calculateBackoff(4, 1000, 10000)).toBe(8000);
    expect(calculateBackoff(5, 1000, 10000)).toBe(10000); // capped
  });

  test('handles edge case of attempt 0', () => {
    // 5000 * 2^(-1) = 2500
    expect(calculateBackoff(0, 5000, 60000)).toBe(2500);
  });
});

describe('parseArgs', () => {
  test('detects --windebug flag', () => {
    expect(parseArgs(['node', 'runner.js', '--windebug']).debug).toBe(true);
    expect(parseArgs(['node', 'runner.js']).debug).toBe(false);
  });

  test('does not detect --debug (conflicts with Claude)', () => {
    expect(parseArgs(['node', 'runner.js', '--debug']).debug).toBe(false);
  });

  test('detects --help flag', () => {
    expect(parseArgs(['node', 'runner.js', '--help']).help).toBe(true);
    expect(parseArgs(['node', 'runner.js']).help).toBe(false);
  });

  test('detects -h short flag', () => {
    expect(parseArgs(['node', 'runner.js', '-h']).help).toBe(true);
  });

  test('detects --version flag', () => {
    expect(parseArgs(['node', 'runner.js', '--version']).version).toBe(true);
    expect(parseArgs(['node', 'runner.js']).version).toBe(false);
  });

  test('detects -v short flag', () => {
    expect(parseArgs(['node', 'runner.js', '-v']).version).toBe(true);
  });

  test('handles multiple flags', () => {
    const result = parseArgs(['node', 'runner.js', '--windebug', '--help']);
    expect(result.debug).toBe(true);
    expect(result.help).toBe(true);
    expect(result.version).toBe(false);
  });

  test('handles empty args', () => {
    const result = parseArgs([]);
    expect(result.debug).toBe(false);
    expect(result.help).toBe(false);
    expect(result.version).toBe(false);
  });

  test('ignores unrelated arguments', () => {
    const result = parseArgs(['node', 'runner.js', '--foo', 'bar', '-x']);
    expect(result.debug).toBe(false);
    expect(result.help).toBe(false);
    expect(result.version).toBe(false);
  });
});
