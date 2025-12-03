/**
 * Unit tests for network error detection
 *
 * Tests the isNetworkError function that determines
 * if an error is network-related for auto-retry logic.
 */

import { isNetworkError } from '../runner.js';

describe('isNetworkError', () => {
  describe('error code detection', () => {
    test('detects ENOTFOUND', () => {
      const error = new Error('getaddrinfo ENOTFOUND api.anthropic.com');
      error.code = 'ENOTFOUND';
      expect(isNetworkError(error)).toBe(true);
    });

    test('detects ETIMEDOUT', () => {
      const error = new Error('Connection timed out');
      error.code = 'ETIMEDOUT';
      expect(isNetworkError(error)).toBe(true);
    });

    test('detects ECONNREFUSED', () => {
      const error = new Error('Connection refused');
      error.code = 'ECONNREFUSED';
      expect(isNetworkError(error)).toBe(true);
    });

    test('detects ECONNRESET', () => {
      const error = new Error('Connection reset by peer');
      error.code = 'ECONNRESET';
      expect(isNetworkError(error)).toBe(true);
    });

    test('detects ENETUNREACH', () => {
      const error = new Error('Network unreachable');
      error.code = 'ENETUNREACH';
      expect(isNetworkError(error)).toBe(true);
    });

    test('detects EAI_AGAIN', () => {
      const error = new Error('Temporary DNS failure');
      error.code = 'EAI_AGAIN';
      expect(isNetworkError(error)).toBe(true);
    });

    test('detects EHOSTUNREACH', () => {
      const error = new Error('Host unreachable');
      error.code = 'EHOSTUNREACH';
      expect(isNetworkError(error)).toBe(true);
    });

    test('detects EPIPE', () => {
      const error = new Error('Broken pipe');
      error.code = 'EPIPE';
      expect(isNetworkError(error)).toBe(true);
    });
  });

  describe('error message detection', () => {
    test('detects "network" in message', () => {
      const error = new Error('Network error occurred');
      expect(isNetworkError(error)).toBe(true);
    });

    test('detects "fetch failed" in message', () => {
      const error = new Error('fetch failed: connection reset');
      expect(isNetworkError(error)).toBe(true);
    });

    test('detects "socket hang up" in message', () => {
      const error = new Error('socket hang up');
      expect(isNetworkError(error)).toBe(true);
    });

    test('detects "ENOTFOUND" in message', () => {
      const error = new Error('getaddrinfo ENOTFOUND api.example.com');
      expect(isNetworkError(error)).toBe(true);
    });

    test('detects "ETIMEDOUT" in message', () => {
      const error = new Error('connect ETIMEDOUT 192.168.1.1:443');
      expect(isNetworkError(error)).toBe(true);
    });

    test('detects "getaddrinfo" in message', () => {
      const error = new Error('getaddrinfo failed');
      expect(isNetworkError(error)).toBe(true);
    });

    test('detects "connect ECONNREFUSED" in message', () => {
      const error = new Error('connect ECONNREFUSED 127.0.0.1:3000');
      expect(isNetworkError(error)).toBe(true);
    });

    test('is case-insensitive for message detection', () => {
      const error = new Error('NETWORK ERROR');
      expect(isNetworkError(error)).toBe(true);
    });
  });

  describe('non-network errors', () => {
    test('returns false for generic errors', () => {
      const error = new Error('Something went wrong');
      expect(isNetworkError(error)).toBe(false);
    });

    test('returns false for EPERM (permission error)', () => {
      const error = new Error('Permission denied');
      error.code = 'EPERM';
      expect(isNetworkError(error)).toBe(false);
    });

    test('returns false for ENOENT (file not found)', () => {
      const error = new Error('File not found');
      error.code = 'ENOENT';
      expect(isNetworkError(error)).toBe(false);
    });

    test('returns false for EACCES (access denied)', () => {
      const error = new Error('Access denied');
      error.code = 'EACCES';
      expect(isNetworkError(error)).toBe(false);
    });

    test('returns false for syntax errors', () => {
      const error = new SyntaxError('Unexpected token');
      expect(isNetworkError(error)).toBe(false);
    });

    test('returns false for type errors', () => {
      const error = new TypeError('undefined is not a function');
      expect(isNetworkError(error)).toBe(false);
    });
  });

  describe('edge cases', () => {
    test('handles error with no message', () => {
      const error = new Error();
      expect(isNetworkError(error)).toBe(false);
    });

    test('handles error with undefined message', () => {
      const error = new Error();
      error.message = undefined;
      expect(isNetworkError(error)).toBe(false);
    });

    test('handles null error', () => {
      expect(() => isNetworkError(null)).not.toThrow();
      expect(isNetworkError(null)).toBe(false);
    });

    test('handles undefined error', () => {
      expect(() => isNetworkError(undefined)).not.toThrow();
      expect(isNetworkError(undefined)).toBe(false);
    });

    test('handles error with both code and message', () => {
      const error = new Error('getaddrinfo ENOTFOUND api.anthropic.com');
      error.code = 'ENOTFOUND';
      expect(isNetworkError(error)).toBe(true);
    });

    test('prioritizes code over message', () => {
      // If code is network-related, should return true even with unrelated message
      const error = new Error('generic error');
      error.code = 'ENOTFOUND';
      expect(isNetworkError(error)).toBe(true);
    });
  });
});
