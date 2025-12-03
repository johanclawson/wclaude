// blocklist.js - Command validation rules for wclaude
//
// This file defines patterns that block potentially dangerous or
// crash-inducing commands before they execute.
//
// To add a new rule:
// 1. Add to cygpathRules (for cygpath crash prevention) or safetyRules (for hang prevention)
// 2. Run tests: npm test
// 3. Test manually with: node -e "import('./blocklist.js').then(m => console.log(m.validateCommand('your command')))"

/**
 * Cygpath crash prevention rules
 * These patterns can crash the session via cygpath -u failures
 */
export const cygpathRules = [
  {
    name: 'nested-quotes',
    pattern: /'[^']*'[^']*'/,
    reason: 'Path contains nested quotes (cygpath crash risk) - use Read/Glob tools instead'
  },
  {
    name: 'shell-expansion',
    pattern: /\$\(|`|\\n|\\r/,
    reason: 'Path contains shell expansion (cygpath crash risk) - use Read/Glob tools instead'
  },
  {
    name: 'unc-path',
    pattern: /\\\\\\\\[A-Za-z0-9]|\/\/[A-Za-z0-9]+\/[A-Za-z0-9]/,
    reason: 'UNC network path detected (cygpath crash risk) - map drive first or use local path'
  }
];

/**
 * Safety rules to prevent commands that hang on large directories
 *
 * Each rule has:
 * - name: identifier for the rule
 * - detect: regex that triggers the rule
 * - unless: regex that exempts from blocking (safe usage pattern)
 * - reason: message shown when blocked
 */
export const safetyRules = [
  {
    name: 'dir-recursive',
    detect: /dir.*\/s/i,
    unless: /\*\.|\.json|\.md|\.txt|\.sh|\.toml|\.xml|\.cs|\.js|\.ts|\.py/i,
    reason: 'dir /s without file pattern - use dir "path\\*.ext" /s or Glob tool'
  },
  {
    name: 'find-no-maxdepth',
    detect: /find.*(Users\/|\/c\/Users|\/home\/[^\/]+\/|\.claude)/i,
    unless: /-maxdepth|timeout/i,
    reason: 'find on user directory without -maxdepth - add -maxdepth N or use Glob tool'
  },
  {
    name: 'tree-no-depth',
    detect: /tree.*(Users\/|\.claude|\/c\/Users|\/home)/i,
    unless: /-L\s+\d+|-l/i,
    reason: 'tree without depth limit - add -L N or use ls'
  },
  {
    name: 'git-all-no-limit',
    detect: /git\s+(log|diff|show).*--all/i,
    unless: /-n\s+\d+|--max-count/i,
    reason: 'git --all without limit - add -n N or --max-count=N'
  }
];

/**
 * Configuration constants
 */
export const config = {
  maxPathLength: 260  // Windows MAX_PATH limit
};

/**
 * Validate a bash command against all blocking rules
 * @param {string} command - The bash command to validate
 * @returns {{ allowed: boolean, reason?: string }}
 */
export function validateCommand(command) {
  if (!command || typeof command !== 'string') {
    return { allowed: true };
  }

  // Check unbalanced quotes (special case - count-based, not regex)
  const singleQuoteCount = (command.match(/'/g) || []).length;
  if (singleQuoteCount % 2 !== 0) {
    return {
      allowed: false,
      reason: 'Command has unbalanced quotes (cygpath crash risk) - ensure quotes are paired'
    };
  }

  // Check cygpath crash rules
  for (const rule of cygpathRules) {
    if (rule.pattern.test(command)) {
      return { allowed: false, reason: rule.reason };
    }
  }

  // Check path length (Windows MAX_PATH limit)
  const pathMatches = command.match(/[A-Za-z]:\\[^ ]+|\/[^ ]+/g) || [];
  for (const p of pathMatches) {
    if (p.length > config.maxPathLength) {
      return {
        allowed: false,
        reason: 'Path exceeds 260 characters (cygpath crash risk) - use shorter paths'
      };
    }
  }

  // Check safety rules (detect + unless pattern)
  for (const rule of safetyRules) {
    if (rule.detect.test(command) && !rule.unless.test(command)) {
      return { allowed: false, reason: rule.reason };
    }
  }

  return { allowed: true };
}

// For backward compatibility with runner.js
export { validateCommand as validateBashCommand };
