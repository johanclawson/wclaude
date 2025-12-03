import { handlePermissionRequest, handleStopHook } from '../runner.js';

describe('handlePermissionRequest', () => {
  describe('auto-approves most tools', () => {
    test('auto-approves Bash tool', () => {
      const input = JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'ls' } });
      const result = JSON.parse(handlePermissionRequest(input));

      expect(result.hookSpecificOutput.hookEventName).toBe('PermissionRequest');
      expect(result.hookSpecificOutput.decision.behavior).toBe('allow');
    });

    test('auto-approves Read tool', () => {
      const input = JSON.stringify({ tool_name: 'Read', tool_input: { path: '/test' } });
      const result = JSON.parse(handlePermissionRequest(input));

      expect(result.hookSpecificOutput.decision.behavior).toBe('allow');
    });

    test('auto-approves Edit tool', () => {
      const input = JSON.stringify({ tool_name: 'Edit', tool_input: {} });
      const result = JSON.parse(handlePermissionRequest(input));

      expect(result.hookSpecificOutput.decision.behavior).toBe('allow');
    });

    test('auto-approves Write tool', () => {
      const input = JSON.stringify({ tool_name: 'Write', tool_input: {} });
      const result = JSON.parse(handlePermissionRequest(input));

      expect(result.hookSpecificOutput.decision.behavior).toBe('allow');
    });

    test('auto-approves WebSearch tool', () => {
      const input = JSON.stringify({ tool_name: 'WebSearch', tool_input: {} });
      const result = JSON.parse(handlePermissionRequest(input));

      expect(result.hookSpecificOutput.decision.behavior).toBe('allow');
    });

    test('response has correct schema (no ok field)', () => {
      const input = JSON.stringify({ tool_name: 'Bash', tool_input: {} });
      const result = JSON.parse(handlePermissionRequest(input));

      // Should NOT have 'ok' field (removed to match Claude Code Zod schema)
      expect(result.ok).toBeUndefined();
      // Should have hookSpecificOutput with correct structure
      expect(result.hookSpecificOutput).toBeDefined();
      expect(result.hookSpecificOutput.hookEventName).toBe('PermissionRequest');
      expect(result.hookSpecificOutput.decision).toBeDefined();
    });
  });

  describe('excludes interactive tools', () => {
    test('does not auto-approve AskUserQuestion', () => {
      const input = JSON.stringify({ tool_name: 'AskUserQuestion', tool_input: {} });
      const result = handlePermissionRequest(input);

      // Excluded tools return empty string (passthrough to normal prompt)
      expect(result).toBe('');
    });

    test('does not auto-approve ExitPlanMode', () => {
      const input = JSON.stringify({ tool_name: 'ExitPlanMode', tool_input: {} });
      const result = handlePermissionRequest(input);

      // Excluded tools return empty string (passthrough to normal prompt)
      expect(result).toBe('');
    });
  });

  describe('error handling', () => {
    test('fails-open on invalid JSON', () => {
      const result = JSON.parse(handlePermissionRequest('invalid json'));

      // Error handling fails-open with allow
      expect(result.hookSpecificOutput.decision.behavior).toBe('allow');
    });

    test('fails-open on empty input', () => {
      const result = JSON.parse(handlePermissionRequest(''));

      expect(result.hookSpecificOutput.decision.behavior).toBe('allow');
    });

    test('fails-open on missing tool_name', () => {
      const input = JSON.stringify({ tool_input: {} });
      const result = JSON.parse(handlePermissionRequest(input));

      // undefined tool_name is not in excludedTools, so it should auto-approve
      expect(result.hookSpecificOutput.decision.behavior).toBe('allow');
    });
  });
});

describe('handleStopHook', () => {
  test('returns empty object (valid hook response)', () => {
    const result = JSON.parse(handleStopHook('{}'));
    // Should return empty object, not { ok: true }
    expect(result).toEqual({});
  });

  test('handles empty input', () => {
    const result = JSON.parse(handleStopHook(''));
    expect(result).toEqual({});
  });

  test('handles complex input', () => {
    const input = JSON.stringify({ event: 'Stop', data: { reason: 'task complete' } });
    const result = JSON.parse(handleStopHook(input));
    expect(result).toEqual({});
  });

  test('extracts project folder from cwd', () => {
    const input = JSON.stringify({ cwd: 'C:\\Users\\test\\projects\\MyApp' });
    // The function should work without errors
    const result = handleStopHook(input);
    expect(() => JSON.parse(result)).not.toThrow();
  });
});
