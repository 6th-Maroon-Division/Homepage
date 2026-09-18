import { defineConfig, devices } from '@playwright/test';

if (process.env.UI_TEST_MODE !== '1' || !process.env.UI_TEST_BASE_URL || !process.env.UI_TEST_DATABASE_URL || process.env.DATABASE_URL !== process.env.UI_TEST_DATABASE_URL) {
  throw new Error('Run browser tests with npm run test:ui to provision an isolated database and website.');
}

export default defineConfig({
  testDir: './tests/ui',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 90000,
  expect: { timeout: 15000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.UI_TEST_BASE_URL,
    actionTimeout: 15000,
    navigationTimeout: 60000,
    timezoneId: 'Europe/Berlin',
    locale: 'en-GB',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
