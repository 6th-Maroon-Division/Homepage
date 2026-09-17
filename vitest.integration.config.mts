import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } },
  test: {
    environment: 'node', include: ['tests/api-integration/**/*.test.ts'],
    fileParallelism: false, maxWorkers: 1, testTimeout: 30_000, hookTimeout: 30_000,
  },
});
