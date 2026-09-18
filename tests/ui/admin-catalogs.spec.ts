import { test, expect } from './fixtures';

export const coveredPages = ['/admin/themes', '/admin/radio-frequencies', '/admin/orbats/subslots', '/admin/templates', '/admin/templates/[id]', '/admin/templates/[id]/edit', '/admin/bot-tokens', '/admin/ranks', '/admin/ranks/migrate'] as const;

test('theme administration explains the system appearance setting', async ({ page, login }) => {
  await login();
  await page.goto('/admin/themes');
  await expect(page.getByRole('heading', { name: 'Theme Management' })).toBeVisible();
  await expect(page.getByText('Theme system has been removed.')).toBeVisible();
});

test('radio frequencies can be created, updated and deleted', async ({ page, login, db, seed }) => {
  const permission = await db.permission.upsert({ where: { key: 'orbat:edit' }, create: { key: 'orbat:edit', maxValue: 255 }, update: {} });
  await db.userPermission.upsert({ where: { userId_permissionId: { userId: seed.adminId, permissionId: permission.id } }, create: { userId: seed.adminId, permissionId: permission.id, value: 255 }, update: { value: 255 } });
  await login();
  await page.goto('/admin/radio-frequencies');
  await page.getByPlaceholder('e.g., 70.0').fill('73.5');
  await page.getByPlaceholder('e.g., Command Net').fill('Browser Catalog Net');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  const row = page.getByRole('row').filter({ hasText: 'Browser Catalog Net' });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByPlaceholder('e.g., 70.0').fill('74.5');
  await page.getByRole('button', { name: 'Update', exact: true }).click();
  await expect(row).toContainText('74.5');
  expect(await db.radioFrequency.count({ where: { callsign: 'Browser Catalog Net', frequency: '74.5' } })).toBe(1);
  page.once('dialog', dialog => dialog.accept());
  await row.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(row).toHaveCount(0);
  expect(await db.radioFrequency.count({ where: { callsign: 'Browser Catalog Net' } })).toBe(0);
});

test('role definitions create and edit reusable signup roles', async ({ page, login, db }) => {
  await login();
  await page.goto('/admin/orbats/subslots');
  await expect(page.getByRole('heading', { name: 'Role Definitions', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'New Definition' }).click();
  await page.locator('input[type="text"]').fill('Browser Catalog Medic');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  const row = page.locator('div.px-6.py-4').filter({ hasText: 'Browser Catalog Medic' });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.locator('input[type="text"]').fill('Browser Catalog Senior Medic');
  await page.getByRole('button', { name: 'Save Changes' }).click();
  await expect(page.getByText('Browser Catalog Senior Medic', { exact: true })).toBeVisible();
  expect(await db.squadRole.count({ where: { name: 'Browser Catalog Senior Medic' } })).toBe(1);
});

test('template list search, editor and legacy edit alias preserve saved changes', async ({ page, login, db, seed }) => {
  const template = await db.orbatTemplate.create({ data: { name: 'Browser Catalog Template', createdById: seed.adminId, frequencyIds: [], slotsJson: [{ name: 'Catalog Alpha', orderIndex: 0, slots: [{ squadRoleId: seed.roleId, orderIndex: 0, maxSignups: 1 }] }] } });
  await login();
  await page.goto('/admin/templates');
  await expect(page.getByRole('heading', { name: 'Templates List' })).toBeVisible();
  await page.getByPlaceholder('Search templates...').fill('Browser Catalog Template');
  await page.getByRole('link', { name: 'Browser Catalog Template', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/templates/${template.id}$`));
  await expect(page.locator('input[type="text"]').first()).toHaveValue('Browser Catalog Template');
  await page.locator('input[type="text"]').first().fill('Browser Catalog Template Revised');
  await page.getByRole('button', { name: 'Save Template' }).click();
  await expect(page).toHaveURL(/\/admin\/templates$/);
  expect((await db.orbatTemplate.findUniqueOrThrow({ where: { id: template.id } })).name).toBe('Browser Catalog Template Revised');
  await page.goto(`/admin/templates/${template.id}/edit`);
  await expect(page).toHaveURL(new RegExp(`/admin/templates/${template.id}$`));
  await expect(page.locator('input[type="text"]').first()).toHaveValue('Browser Catalog Template Revised');
});

test('bot token administration creates, renames, disables and deletes a local token', async ({ page, login, db }) => {
  await login();
  await page.goto('/admin/bot-tokens');
  await expect(page.getByRole('heading', { name: 'Bot API Tokens', exact: true })).toBeVisible();
  await page.getByPlaceholder('Token name (e.g., Main Bot, Backup Bot)').fill('Browser Catalog Token');
  await page.getByRole('button', { name: 'Create Token', exact: true }).click();
  await expect(page.getByText('New Token Created!', { exact: true })).toBeVisible();
  const row = page.getByRole('row').filter({ hasText: 'Browser Catalog Token' });
  await row.getByRole('button', { name: 'Rename', exact: true }).click();
  await page.getByRole('row').filter({ has: page.locator('input') }).locator('input').fill('Browser Catalog Token Revised');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const updated = page.getByRole('row').filter({ hasText: 'Browser Catalog Token Revised' });
  await updated.getByRole('button', { name: 'Disable', exact: true }).click();
  await expect(updated.getByRole('button', { name: 'Enable', exact: true })).toBeVisible();
  expect((await db.botToken.findFirstOrThrow({ where: { name: 'Browser Catalog Token Revised' } })).isActive).toBe(false);
  await updated.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Confirm Delete' })).toBeVisible();
  await page.getByRole('button', { name: 'Delete', exact: true }).last().click();
  await expect(updated).toHaveCount(0);
  expect(await db.botToken.count({ where: { name: 'Browser Catalog Token Revised' } })).toBe(0);
});

test('rank administration creates, updates and deletes a rank without provider requests', async ({ page, login, db }) => {
  await login();
  await page.goto('/admin/ranks');
  await expect(page.getByRole('heading', { name: 'Manage Ranks' })).toBeVisible();
  await page.getByPlaceholder('Name', { exact: true }).fill('Browser Catalog Corporal');
  await page.getByPlaceholder('Abbreviation', { exact: true }).fill('BCC');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  const row = page.locator('[draggable="true"]').filter({ has: page.locator('input[value="Browser Catalog Corporal"]') });
  await expect(row).toBeVisible();
  await row.getByPlaceholder('Attendance', { exact: true }).fill('3');
  await expect(row.getByPlaceholder('Attendance', { exact: true })).toHaveValue('3');
  const saved = page.waitForResponse(response => /\/api\/ranks\/\d+$/.test(response.url()) && response.request().method() === 'PATCH');
  await row.getByRole('button', { name: 'Save', exact: true }).click();
  const response = await saved;
  expect(response.request().postDataJSON().attendanceRequiredSinceLastRank).toBe(3);
  expect(response.ok()).toBeTruthy();
  await expect.poll(async () => (await db.rank.findUnique({ where: { abbreviation: 'BCC' } }))?.attendanceRequiredSinceLastRank).toBe(3);
  await row.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(row).toHaveCount(0);
  expect(await db.rank.count({ where: { abbreviation: 'BCC' } })).toBe(0);
});

test('rank migration wizard previews the grandfather strategy without changing ranks', async ({ page, login, db, seed }) => {
  const permission = await db.permission.upsert({ where: { key: 'rank:edit' }, create: { key: 'rank:edit', maxValue: 255 }, update: {} });
  await db.userPermission.upsert({ where: { userId_permissionId: { userId: seed.adminId, permissionId: permission.id } }, create: { userId: seed.adminId, permissionId: permission.id, value: 255 }, update: { value: 255 } });
  await db.rank.create({ data: { name: 'Browser Catalog Migration Rank', abbreviation: 'BCM', orderIndex: 100 } });
  await login();
  await page.goto('/admin/ranks/migrate');
  await expect(page.getByRole('heading', { name: 'Rank System Migration', exact: true })).toBeVisible();
  await expect(page.getByText('BCM - Browser Catalog Migration Rank', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'I Have a Backup - Proceed' }).click();
  await page.getByRole('radio', { name: /Grandfather/ }).check();
  await page.getByRole('button', { name: 'Next: Preview Changes' }).click();
  await page.getByRole('button', { name: 'Generate Preview' }).click();
  await expect(page.getByText('Total Users', { exact: true })).toBeVisible();
  await expect(page.getByText('Unchanged', { exact: true }).first()).toBeVisible();
  expect(await db.rank.count({ where: { abbreviation: 'BCM' } })).toBe(1);
});

test('late initial rank responses cannot overwrite a new rank or its unsaved attendance requirement', async ({ page, login, db }) => {
  await login();
  const rankListUrl = /\/api\/ranks(?:\?.*)?$/;
  let holdInitialRequests = true;
  let capturedSnapshots = 0;
  let releaseInitialResponses!: () => void;
  const responseGate = new Promise<void>(resolve => { releaseInitialResponses = resolve; });
  const pendingResponses: Promise<void>[] = [];

  await page.route(rankListUrl, route => {
    if (route.request().method() !== 'GET' || !holdInitialRequests) return route.continue();
    const pending = (async () => {
      // Fetch the real database snapshot now, then deliver it after a newer
      // refresh and a user edit. This also holds StrictMode's second request.
      const response = await route.fetch();
      expect(response.ok()).toBeTruthy();
      capturedSnapshots++;
      await responseGate;
      await route.fulfill({ response });
    })();
    pendingResponses.push(pending);
    return pending;
  });

  try {
    await page.goto('/admin/ranks');
    await expect.poll(() => capturedSnapshots).toBeGreaterThan(0);
    await page.getByPlaceholder('Name', { exact: true }).fill('Browser Delayed Rank');
    await page.getByPlaceholder('Abbreviation', { exact: true }).fill('BDR');
    holdInitialRequests = false;
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    const row = page.locator('[draggable="true"]').filter({ has: page.locator('input[value="Browser Delayed Rank"]') });
    await expect(row).toBeVisible();
    const attendance = row.getByPlaceholder('Attendance', { exact: true });
    await attendance.fill('3');
    await expect(attendance).toHaveValue('3');

    const received = page.waitForResponse(response => rankListUrl.test(response.url()) && response.request().method() === 'GET');
    releaseInitialResponses();
    await Promise.all(pendingResponses);
    await (await received).finished();
    // Wait for React to commit any queued response updates, without a timed sleep.
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect(attendance).toHaveValue('3');

    const persisted = await db.rank.findUniqueOrThrow({ where: { abbreviation: 'BDR' } });
    const saved = page.waitForResponse(response => response.url().endsWith(`/api/ranks/${persisted.id}`) && response.request().method() === 'PATCH');
    await row.getByRole('button', { name: 'Save', exact: true }).click();
    const response = await saved;
    expect(response.request().postDataJSON().attendanceRequiredSinceLastRank).toBe(3);
    expect(response.ok()).toBeTruthy();
    expect((await db.rank.findUniqueOrThrow({ where: { id: persisted.id } })).attendanceRequiredSinceLastRank).toBe(3);
  } finally {
    releaseInitialResponses();
    await Promise.allSettled(pendingResponses);
    await page.unroute(rankListUrl);
    await db.rank.deleteMany({ where: { abbreviation: 'BDR' } });
  }
});
