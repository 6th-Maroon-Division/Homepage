import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } },
  test: {
    environment: 'node',
    include: ['tests/api/**/*.test.ts'],
    clearMocks: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary', 'lcov'],
      reportsDirectory: 'coverage/api',
      include: [
        'lib/api/**/*.ts', 'lib/notification-preferences.ts',
        'app/api/bot-tokens/route.ts', 'app/api/bot-tokens/[[]id]/route.ts',
        'app/api/users/[[]id]/notification-preferences/route.ts', 'app/api/audit-logs/route.ts',
      ],
      thresholds: { lines: 80, branches: 80, functions: 80, statements: 80 },
    },
  },
});
