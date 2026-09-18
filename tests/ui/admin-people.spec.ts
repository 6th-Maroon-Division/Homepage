import { test, expect } from './fixtures';

export const coveredPages = ['/admin/users', '/admin/users/[id]', '/admin/trainings', '/admin/promotions', '/admin/messaging', '/admin/attendance', '/admin/attendance/[id]', '/admin/attendance/statistics'] as const;

test('user directory filters users and opens a profile with editable local identity', async ({ page, login, db }) => {
  const user = await db.user.create({ data: { username: 'UI Directory Subject' } });
  await login();
  await page.goto('/admin/users');
  await expect(page.getByRole('main').getByRole('heading', { name: 'User Management', exact: true })).toBeVisible();
  await page.getByPlaceholder('Search users...').fill('not-a-real-member');
  await expect(page.getByText('No users found', { exact: true })).toBeVisible();
  await page.getByPlaceholder('Search users...').fill('UI Directory Subject');
  await page.locator(`a[href="/admin/users/${user.id}"]`).first().click();
  await expect(page.getByRole('main').getByRole('heading', { name: user.username!, exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Attendance', exact: true }).click();
  await expect(page.getByText('No attendance records.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'LOA', exact: true }).click();
  await expect(page.getByText('No LOA entries.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Actions', exact: true }).click();
  await page.getByPlaceholder('Enter username').fill('UI Directory Renamed');
  const saved = page.waitForResponse(r => r.url().includes(`/api/users/${user.id}`) && r.request().method() === 'PATCH');
  await page.getByRole('button', { name: 'Save Username', exact: true }).click();
  expect((await saved).ok()).toBeTruthy();
  expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).username).toBe('UI Directory Renamed');
  await page.reload();
  await expect(page.getByRole('main').getByRole('heading', { name: 'UI Directory Renamed', exact: true })).toBeVisible();
});

test('training management creates a training and filters the persisted catalog', async ({ page, login, db }) => {
  await login();
  await page.goto('/admin/trainings');
  await expect(page.getByRole('main').getByRole('heading', { name: 'Training Management', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'New Training', exact: true }).click();
  const form = page.locator('form').filter({ has: page.locator('input[required]') });
  await form.locator('input[required]').fill('UI Navigation Training');
  await form.locator('textarea').first().fill('Practice navigation without provider integrations.');
  const saved = page.waitForResponse(r => r.url().endsWith('/api/trainings') && r.request().method() === 'POST');
  await form.getByRole('button', { name: 'Create', exact: true }).click();
  expect((await saved).status()).toBe(201);
  await expect(page.getByRole('main').getByRole('heading', { name: 'UI Navigation Training', exact: true })).toBeVisible();
  expect(await db.training.count({ where: { name: 'UI Navigation Training' } })).toBe(1);
  await page.getByPlaceholder('Search trainings').fill('missing-training');
  await expect(page.getByText('No trainings match your filters', { exact: true })).toBeVisible();
  await page.getByPlaceholder('Search trainings').fill('UI Navigation');
  await expect(page.getByRole('main').getByRole('heading', { name: 'UI Navigation Training', exact: true })).toBeVisible();
  await page.getByRole('button', { name: /^Pending Requests/ }).click();
  await expect(page.getByText('No pending requests', { exact: true })).toBeVisible();
});

test('promotion queue renders and refreshes without triggering provider actions', async ({ page, login }) => {
  await login();
  await page.goto('/admin/promotions');
  await expect(page.getByText('No pending promotions', { exact: true })).toBeVisible();
  const refreshed = page.waitForResponse(r => r.url().includes('/api/ranks/promotions/pending') && r.request().method() === 'GET');
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  expect((await refreshed).ok()).toBeTruthy();
  await expect(page.getByText('No pending promotions', { exact: true })).toBeVisible();
});

test('messaging sends a web notification to the selected audience', async ({ page, login, db, seed }) => {
  await login();
  await page.goto('/admin/messaging');
  await expect(page.getByRole('main').getByRole('heading', { name: 'Send Message / Notification', exact: true })).toBeVisible();
  await page.getByPlaceholder('Message title').fill('UI Admin Notice');
  await page.getByPlaceholder('Message content').fill('A local browser-test notification.');
  await page.locator('select').filter({ has: page.locator('option[value="admin"]') }).selectOption('admin');
  const saved = page.waitForResponse(r => r.url().endsWith('/api/messages') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Send Message', exact: true }).click();
  expect((await saved).status()).toBe(201);
  await expect(page.getByPlaceholder('Message title')).toHaveValue('');
  const message = await db.message.findFirstOrThrow({ where: { title: 'UI Admin Notice' }, include: { recipients: true } });
  expect(message.body).toBe('A local browser-test notification.');
  expect(message.recipients.some(r => r.userId === seed.adminId && r.channel === 'web')).toBeTruthy();
  expect(message.recipients.some(r => r.userId === seed.memberId)).toBeFalsy();
});

test('attendance overview opens an operation, saves attendance and shows statistics', async ({ page, login, db, seed }) => {
  const user = await db.user.create({ data: { username: 'UI Attendance Subject' } });
  const date = new Date(Date.now() - 86400000);
  const operation = await db.orbat.create({ data: { name: 'UI Attendance Operation', createdById: seed.adminId, startsAtUtc: date, eventDate: date } });
  await login();
  await page.goto('/admin/attendance');
  await expect(page.getByRole('main').getByRole('heading', { name: 'Attendance Management', exact: true })).toBeVisible();
  await page.locator(`a[href="/admin/attendance/${operation.id}"]`).first().click();
  await expect(page.getByRole('main').getByRole('heading', { name: operation.name, exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Create Attendance', exact: true }).click();
  const form = page.locator('form');
  await form.locator('select').filter({ has: page.locator(`option[value="${user.id}"]`, { hasText: user.username! }) }).selectOption(String(user.id));
  await form.locator('select').filter({ has: page.locator('option[value="present"]') }).selectOption('present');
  await form.locator('textarea').fill('Present during browser test');
  const saved = page.waitForResponse(r => r.url().endsWith(`/api/orbats/${operation.id}/attendance`) && r.request().method() === 'POST');
  await form.getByRole('button', { name: 'Save', exact: true }).click();
  expect((await saved).ok()).toBeTruthy();
  await expect(page.getByRole('row').filter({ hasText: user.username! }).getByRole('cell', { name: 'present', exact: true })).toBeVisible();
  expect(await db.attendance.findFirstOrThrow({ where: { orbatId: operation.id, userId: user.id } })).toMatchObject({ status: 'present', notes: 'Present during browser test' });
  await page.getByRole('link', { name: '← Back to Attendance', exact: true }).click();
  await page.getByRole('link', { name: 'View Statistics', exact: true }).click();
  await expect(page.getByRole('main').getByRole('heading', { name: 'Attendance Statistics', exact: true })).toBeVisible();
  const operations = await db.orbat.findMany({ where: { isSideOp: false, OR: [{ startsAtUtc: { not: null } }, { eventDate: { not: null } }] }, include: { attendances: true }, orderBy: [{ startsAtUtc: 'desc' }, { eventDate: 'desc' }], take: 100 });
  const recent = operations.filter(op => (op.startsAtUtc ?? op.eventDate)! < new Date()).slice(0, 4);
  const average = recent.reduce((sum, op) => sum + op.attendances.filter(a => ['present', 'late', 'gone_early', 'partial'].includes(a.status)).length, 0) / recent.length;
  await expect(page.getByText('Last 4 Ops', { exact: true }).locator('..')).toContainText(`${average.toFixed(1)} avg attendees`);
  await expect(page.getByRole('main').getByRole('heading', { name: '6-Month Trend', exact: true })).toBeVisible();
});
