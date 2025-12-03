/**
 * Jest configuration for wclaude
 *
 * Uses ES Modules with experimental VM modules support.
 * Run tests with: npm test
 */
export default {
  // Use ESM
  testEnvironment: 'node',

  // Test file patterns
  testMatch: [
    '**/tests/**/*.test.js'
  ],

  // Ignore patterns
  testPathIgnorePatterns: [
    '/node_modules/'
  ],

  // Coverage configuration
  collectCoverageFrom: [
    'runner.js'
  ],
  coverageDirectory: 'coverage',
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 80,
      lines: 75,
      statements: 75
    }
  },

  // ESM support
  transform: {},

  // Verbose output
  verbose: true,

  // Force exit after tests complete (IIFE in runner.js starts background work)
  forceExit: true
};
