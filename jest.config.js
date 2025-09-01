export default {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapping: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@pr-receptor/(.*)$': '<rootDir>/src/pr-receptor/$1',
    '^@pr-processor/(.*)$': '<rootDir>/src/pr-processor/$1',
    '^@shared/(.*)$': '<rootDir>/src/shared/$1',
  },
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      useESM: true,
      tsconfig: {
        module: 'ESNext'
      }
    }]
  },
  testMatch: [
    '<rootDir>/src/**/__tests__/**/*.ts',
    '<rootDir>/src/**/?(*.)+(spec|test).ts',
    '<rootDir>/test/**/*.ts'
  ],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/**/__tests__/**',
    '!src/**/index.ts'
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  setupFilesAfterEnv: ['<rootDir>/test/setup.ts']
};