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
        'app/api/ranks/discord-roles/route.ts', 'app/api/ranks/[[]id]/discord-role/route.ts',
        'app/api/users/[[]id]/leave-of-absences/route.ts', 'app/api/leave-of-absences/[[]id]/route.ts',
        'app/api/ranks/route.ts', 'app/api/ranks/[[]id]/route.ts', 'app/api/ranks/reorder/route.ts',
        'app/api/training-users/route.ts',
        'lib/api/**/*.ts', 'lib/notification-preferences.ts',
        'app/api/bot-tokens/route.ts', 'app/api/bot-tokens/[[]id]/route.ts',
        'app/api/users/[[]id]/notification-preferences/route.ts', 'app/api/audit-logs/route.ts',
        'app/api/radio-frequencies/**/route.ts', 'app/api/subslot-definitions/**/route.ts', 'app/api/training-categories/**/route.ts',
      ],
      thresholds: { lines: 80, branches: 80, functions: 80, statements: 80 },
    },
  },
});
