import { validateBashCommand } from '../runner.js';
import { validateCommand, cygpathRules, safetyRules, config } from '../blocklist.js';

describe('validateBashCommand', () => {
  describe('allows safe commands', () => {
    test('allows normal commands', () => {
      expect(validateBashCommand('ls -la')).toEqual({ allowed: true });
      expect(validateBashCommand('git status')).toEqual({ allowed: true });
      expect(validateBashCommand('npm install')).toEqual({ allowed: true });
    });

    test('allows null/undefined/empty', () => {
      expect(validateBashCommand(null)).toEqual({ allowed: true });
      expect(validateBashCommand(undefined)).toEqual({ allowed: true });
      expect(validateBashCommand('')).toEqual({ allowed: true });
    });

    test('allows dir /s with file pattern', () => {
      expect(validateBashCommand('dir "C:\\path\\*.json" /s').allowed).toBe(true);
      expect(validateBashCommand('dir "C:\\path\\*.md" /s').allowed).toBe(true);
      expect(validateBashCommand('dir "C:\\path\\*.txt" /s').allowed).toBe(true);
    });

    test('allows find with -maxdepth', () => {
      expect(validateBashCommand('find /c/Users/johan -maxdepth 3 -type f').allowed).toBe(true);
    });

    test('allows find with timeout', () => {
      expect(validateBashCommand('timeout 30s find /c/Users/johan -type f').allowed).toBe(true);
    });

    test('allows tree with -L', () => {
      expect(validateBashCommand('tree -L 2 /c/Users/johan/.claude').allowed).toBe(true);
    });

    test('allows git --all with limit', () => {
      expect(validateBashCommand('git log --all -n 50').allowed).toBe(true);
      expect(validateBashCommand('git log --all --max-count=100').allowed).toBe(true);
    });
  });

  describe('cygpath crash prevention', () => {
    test('blocks nested quotes', () => {
      // Use balanced quotes to test nested quotes specifically
      const result = validateBashCommand("cat '/path'\"s\"' name/file'");
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('nested quotes');
    });

    test('blocks unbalanced quotes (odd number)', () => {
      // 3 single quotes = unbalanced
      const result = validateBashCommand("cat '/path's name/file'");
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('unbalanced');
    });

    test('blocks unbalanced quotes', () => {
      const result = validateBashCommand("ls '/path/to/file");
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('unbalanced');
    });

    test('blocks shell expansion', () => {
      const result = validateBashCommand('cat "/path/$(date)/file"');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('shell expansion');
    });

    test('blocks backtick expansion', () => {
      const result = validateBashCommand('cat "/path/`date`/file"');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('shell expansion');
    });

    test('blocks UNC paths', () => {
      const result = validateBashCommand('ls //server/share/file');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('UNC');
    });

    test('blocks very long paths', () => {
      const longPath = '/c/Users/' + 'a'.repeat(300) + '/file';
      const result = validateBashCommand(`cat "${longPath}"`);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('260');
    });
  });

  describe('safety checks', () => {
    test('blocks dir /s without pattern', () => {
      const result = validateBashCommand('dir "C:\\Users\\johan\\.claude" /s /b');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('dir /s');
    });

    test('blocks find without maxdepth on user dirs', () => {
      const result = validateBashCommand('find /c/Users/johan/.claude -type f');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('maxdepth');
    });

    test('blocks tree without depth on user dirs', () => {
      const result = validateBashCommand('tree /c/Users/johan/.claude');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('depth');
    });

    test('blocks git --all without limit', () => {
      const result = validateBashCommand('git log --all');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('limit');
    });

    test('blocks git diff --all without limit', () => {
      const result = validateBashCommand('git diff --all');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('limit');
    });
  });
});

describe('blocklist.js exports', () => {
  test('validateCommand is same as validateBashCommand', () => {
    expect(validateCommand('ls -la')).toEqual(validateBashCommand('ls -la'));
    expect(validateCommand('find /c/Users/test -type f')).toEqual(
      validateBashCommand('find /c/Users/test -type f')
    );
  });

  test('cygpathRules is exported array', () => {
    expect(Array.isArray(cygpathRules)).toBe(true);
    expect(cygpathRules.length).toBeGreaterThan(0);
    expect(cygpathRules[0]).toHaveProperty('name');
    expect(cygpathRules[0]).toHaveProperty('pattern');
    expect(cygpathRules[0]).toHaveProperty('reason');
  });

  test('safetyRules is exported array', () => {
    expect(Array.isArray(safetyRules)).toBe(true);
    expect(safetyRules.length).toBeGreaterThan(0);
    expect(safetyRules[0]).toHaveProperty('name');
    expect(safetyRules[0]).toHaveProperty('detect');
    expect(safetyRules[0]).toHaveProperty('unless');
    expect(safetyRules[0]).toHaveProperty('reason');
  });

  test('config has maxPathLength', () => {
    expect(config).toHaveProperty('maxPathLength');
    expect(config.maxPathLength).toBe(260);
  });
});
