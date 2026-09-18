import { defineConfig } from 'vitest/config';

// One coverage map across isolated unit tests and real Prisma integration tests.
// Include every route and library, even files that no test imports.
export default defineConfig({
  test: {
    fileParallelism: false,
    maxWorkers: 1,
    projects: [
      { extends: './vitest.config.mts', test: { name: 'unit' } },
      { extends: './vitest.integration.config.mts', test: { name: 'integration' } },
    ],
    coverage: {
      provider: 'v8',
      include: ['app/api/**/route.ts', 'lib/**/*.ts'],
      exclude: ['lib/**/*.d.ts'],
      reporter: ['text', 'html', 'json-summary', 'json', 'lcov'],
      reportsDirectory: 'coverage/backend',
      thresholds: { lines: 80, branches: 80, functions: 80, statements: 80 },
    },
  },
});
