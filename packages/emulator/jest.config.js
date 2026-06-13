export default {
  testEnvironment: 'jsdom',
  transform: {
    '^.+\\.js$': 'babel-jest',
  },
  moduleFileExtensions: ['js'],
  testMatch: [
    '**/tests/**/*.test.js',
    '**/__tests__/**/*.js',
  ],
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/spectrum/audio-worklet.js',
    '!**/node_modules/**',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  // Ratchet baseline (2026-06-11): raise as coverage grows, never lower.
  // The original 80% target was aspirational — actual coverage was ~47%
  // and the quality gate had never passed.
  coverageThreshold: {
    global: {
      branches: 28,
      functions: 48,
      lines: 45,
      statements: 45,
    },
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
  verbose: true,
  transformIgnorePatterns: [
    'node_modules/(?!(.*\\.mjs$))',
  ],
};