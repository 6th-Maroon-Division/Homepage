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
        'app/api/trainings/[[]id]/requirements/route.ts',
        'app/api/trainings/route.ts', 'app/api/trainings/[[]id]/route.ts',
        'app/api/ranks/[[]id]/requirements/route.ts',
        'app/api/users/[[]id]/rank/route.ts', 'app/api/users/[[]id]/rank-history/route.ts',
        'app/api/users/[[]id]/status/route.ts', 'app/api/users/status/route.ts',
        'app/api/users/ranks/route.ts',
        'app/api/ranks/promotions/pending/route.ts',
        'app/api/orbats/[[]id]/full/route.ts',
        'app/api/orbats/calendar/route.ts',
        'app/api/orbats/route.ts', 'app/api/orbats/[[]id]/route.ts',
        'app/api/users/route.ts', 'app/api/users/[[]id]/route.ts',
        'app/api/ranks/promotions/propose/route.ts', 'app/api/ranks/promotions/automatic/route.ts',
        'app/api/templates/route.ts', 'app/api/templates/[[]id]/route.ts', 'app/api/templates/access/route.ts',
        'app/api/permissions/templates/route.ts', 'app/api/permissions/templates/[[]id]/route.ts',
        'app/api/ranks/promotions/[[]id]/approve/route.ts', 'app/api/ranks/promotions/[[]id]/decline/route.ts',
        'lib/api/**/*.ts', 'lib/notification-preferences.ts',
        'app/api/bot-tokens/route.ts', 'app/api/bot-tokens/[[]id]/route.ts',
        'app/api/users/[[]id]/notification-preferences/route.ts', 'app/api/audit-logs/route.ts',
        'app/api/radio-frequencies/**/route.ts', 'app/api/subslot-definitions/**/route.ts', 'app/api/training-categories/**/route.ts',
      ],
      thresholds: { lines: 80, branches: 80, functions: 80, statements: 80 },
    },
  },
});
