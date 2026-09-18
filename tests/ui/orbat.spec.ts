import { test, expect } from './fixtures';

export const coveredPages = ['/orbats', '/orbats/[id]', '/admin/orbats/[id]/edit'] as const;

test('public ORBAT shows briefing and roles without signup controls', async ({ page, seed }) => {
  await page.goto(`/orbats/${seed.orbatId}`);
  await expect(page.getByRole('heading', { name: 'Browser Public Operation', exact: true })).toBeVisible();
  await expect(page.getByText('Public operation briefing', { exact: true })).toBeVisible();
  await expect(page.getByText('Browser Rifleman', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign up', exact: true })).toHaveCount(0);
});

test('member can sign up through the UI and the signup is persisted', async ({ page, login, seed, db }) => {
  await login('member');
  await page.goto(`/orbats/${seed.orbatId}`);
  const saved = page.waitForResponse(response => response.url().endsWith('/api/signups') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Sign up', exact: true }).click();
  expect((await saved).ok()).toBeTruthy();
  await expect(page.getByRole('button', { name: 'Remove', exact: true })).toBeVisible();
  expect(await db.signup.count({ where: { userId: seed.memberId, slot: { orbatId: seed.orbatId } } })).toBe(1);
});

test('template role transmits and persists its untouched default signup limit', async ({ page, login, seed, db }) => {
  await login();
  await page.goto('/admin/templates/new');
  await expect(page.getByRole('heading', { name: 'Create Template', exact: true })).toBeVisible();
  await page.locator('input[type="text"]').first().fill('Browser Default Limit Template');
  await page.getByRole('button', { name: '+ Add Squad', exact: true }).click();
  await page.getByPlaceholder('e.g., Platoon 1').fill('Template Alpha');
  await page.locator('select').filter({ has: page.locator('option', { hasText: 'Select slot...' }) }).selectOption(String(seed.roleId));
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.locator('input[type="number"]').first()).toHaveValue('1');
  const saved = page.waitForResponse(response => response.url().endsWith('/api/templates') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Save Template', exact: true }).click();
  const response = await saved;
  expect(response.request().postDataJSON().slotsJson[0].slots[0].maxSignups).toBe(1);
  expect(response.status()).toBe(201);
  await expect(page).toHaveURL(/\/admin\/templates$/);
  const row = await db.orbatTemplate.findFirstOrThrow({ where: { name: 'Browser Default Limit Template' } });
  expect(row.slotsJson).toMatchObject([{ slots: [{ maxSignups: 1, squadRoleId: seed.roleId }] }]);
});

for (const [date, expectedUtc] of [['2099-07-20', '2099-07-20T17:00:00.000Z'], ['2099-01-20', '2099-01-20T18:00:00.000Z']]) {
  test(`Berlin 19:00 is saved in UTC for ${date}`, async ({ page, login, seed, db }) => {
    await login();
    await page.goto(`/admin/orbats/${seed.orbatId}/edit`);
    await page.locator('#eventDate').fill(date);
    await page.locator('#startTime').click();
    const dial = page.getByRole('group', { name: 'Start Time clock picker' });
    // Select 19 on the outer hour ring, then 00 at the top of the minute ring.
    await dial.click({ position: { x: 78, y: 226 } });
    await dial.click({ position: { x: 132, y: 24 } });
    await expect(page.locator('#startTime')).toContainText('7:00');
    const saved = page.waitForResponse(response => response.url().endsWith(`/api/orbats/${seed.orbatId}`) && response.request().method() === 'PATCH');
    await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
    const response = await saved;
    expect(response.request().postDataJSON().startsAtUtc).toBe(expectedUtc);
    expect(response.ok()).toBeTruthy();
    expect((await db.orbat.findUniqueOrThrow({ where: { id: seed.orbatId } })).startsAtUtc?.toISOString()).toBe(expectedUtc);
    await page.goto(`/admin/orbats/${seed.orbatId}/edit`);
    await expect(page.locator('#startTime')).toContainText('7:00');
    await expect(page.locator('#eventDate')).toHaveValue(date);
  });
}

test('open public calendar updates after creation, edits and deletion without reload', async ({ page, context, login, seed }) => {
  await login();
  const observer = await context.browser()!.newContext({ baseURL: process.env.UI_TEST_BASE_URL, timezoneId: 'Europe/Berlin' });
  const calendar = await observer.newPage();
  try {
    const connected = calendar.waitForResponse(response => response.url().includes('/api/orbats/calendar'));
    await calendar.goto('/orbats');
    await connected;
    const created = await page.request.post('/api/orbats', { data: { name: 'Browser Live Calendar', startsAtUtc: '2099-09-20T17:00:00Z', squads: [{ name: 'Calendar Alpha', orderIndex: 0, slots: [{ squadRoleId: seed.roleId, orderIndex: 0, maxSignups: 1 }] }] } });
    expect(created.status()).toBe(201);
    const { data: { id } } = await created.json();
    await expect(calendar.getByText('Browser Live Calendar', { exact: true })).toBeVisible({ timeout: 10000 });
    const edited = await page.request.patch(`/api/orbats/${id}`, { data: { name: 'Browser Calendar Renamed', startsAtUtc: '2099-09-21T18:00:00Z', description: 'Changed calendar briefing', isSideOp: true } });
    expect(edited.ok()).toBeTruthy();
    await expect(calendar.getByRole('button', { name: /^Browser Calendar Renamed/ })).toBeVisible({ timeout: 10000 });
    await expect(calendar.getByText('Browser Live Calendar', { exact: true })).toHaveCount(0);
    const removed = await page.request.delete(`/api/orbats/${id}`);
    expect(removed.ok()).toBeTruthy();
    await expect(calendar.getByRole('button', { name: /^Browser Calendar Renamed/ })).toHaveCount(0, { timeout: 10000 });
  } finally { await observer.close(); }
});

test('calendar create defaults initialize locally and subsequent form edits keep the selected schedule', async ({ page, login }) => {
  await login();
  await page.goto('/admin/orbats/new?date=2099-07-21');
  await expect(page.locator('#eventDate')).toHaveValue('2099-07-21');
  await expect(page.locator('#startTime')).toContainText('7:00');
  await expect(page.locator('#endTime')).toContainText('9:00');
  await page.locator('#eventDate').fill('2099-07-22');
  await page.locator('#startTime').click();
  const dial = page.getByRole('group', { name: 'Start Time clock picker' });
  await dial.click({ position: { x: 132, y: 240 } });
  await dial.click({ position: { x: 132, y: 24 } });
  await page.locator('#name').fill('Calendar editor retained state');
  await expect(page.locator('#eventDate')).toHaveValue('2099-07-22');
  await expect(page.locator('#startTime')).toContainText('6:00');
  await expect(page.locator('#name')).toHaveValue('Calendar editor retained state');
});
