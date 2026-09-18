import { test, expect } from './fixtures';

export const coveredPages = ['/admin', '/admin/orbats', '/admin/orbats/new', '/admin/orbats/[id]'] as const;

test('admin dashboard links to operation management and search filters the list', async ({ page, login, seed }) => {
  await login();
  await page.goto('/admin');
  await page.getByRole('link', { name: /OrbATs Manage operations/ }).click();
  await expect(page).toHaveURL(/\/admin\/orbats$/);
  const search = page.getByPlaceholder('Search operations...');
  await search.fill('no-such-browser-operation');
  await expect(page.locator(`a[href="/admin/orbats/${seed.orbatId}"]`)).toHaveCount(0);
  await search.fill('Browser Public Operation');
  await page.locator(`a[href="/admin/orbats/${seed.orbatId}"]`).click();
  await expect(page.getByRole('heading', { name: 'Browser Public Operation', exact: true })).toBeVisible();
  await expect(page.getByText('Browser Rifleman', { exact: true })).toBeVisible();
});

test('admin creates an operation with a role then deletes it through confirmation', async ({ page, login, seed, db }) => {
  await login();
  await page.goto('/admin/orbats/new');
  await page.getByLabel('Name', { exact: false }).first().fill('Browser Created Operation');
  await page.locator('#eventDate').fill('2099-09-21');
  await page.getByRole('button', { name: '+ Add Slot', exact: true }).click();
  await page.getByPlaceholder('e.g., Command Element, Rifle Platoon').fill('Created Alpha');
  await page.locator('select').filter({ has: page.locator('option', { hasText: 'Select role...' }) }).selectOption(String(seed.roleId));
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  const saved = page.waitForResponse(response => response.url().endsWith('/api/orbats') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Create OrbAT', exact: true }).click();
  const response = await saved;
  expect(response.status()).toBe(201);
  const { data: { id } } = await response.json();
  await expect(page).toHaveURL(new RegExp(`/orbats/${id}$`));
  await expect(page.getByRole('heading', { name: 'Browser Created Operation', exact: true })).toBeVisible();
  const operation = await db.orbat.findUniqueOrThrow({ where: { id }, include: { squads: { include: { slots: true } } } });
  expect(operation.squads[0].slots[0]).toMatchObject({ squadRoleId: seed.roleId, maxSignups: 1 });
  await page.goto('/admin/orbats');
  await page.getByPlaceholder('Search operations...').fill('Browser Created Operation');
  await page.getByRole('row').filter({ hasText: 'Browser Created Operation' }).getByRole('button', { name: 'Delete', exact: true }).click();
  const modal = page.getByRole('heading', { name: 'Delete OrbAT', exact: true }).locator('..');
  await modal.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(await db.orbat.count({ where: { id } })).toBe(1);
  await page.getByRole('row').filter({ hasText: 'Browser Created Operation' }).getByRole('button', { name: 'Delete', exact: true }).click();
  const removed = page.waitForResponse(response => response.url().endsWith(`/api/orbats/${id}`) && response.request().method() === 'DELETE');
  await modal.getByRole('button', { name: 'Delete', exact: true }).click();
  expect((await removed).ok()).toBeTruthy();
  await expect(page.getByRole('row').filter({ hasText: 'Browser Created Operation' })).toHaveCount(0);
  expect(await db.orbat.count({ where: { id } })).toBe(0);
});

for (const role of ['anonymous', 'member'] as const) {
  test(`${role} cannot open admin operation pages`, async ({ page, login, seed }) => {
    if (role === 'member') await login('member');
    for (const path of ['/admin', '/admin/orbats', '/admin/orbats/new', `/admin/orbats/${seed.orbatId}`, `/admin/orbats/${seed.orbatId}/edit`]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/orbats$/);
      await expect(page.getByRole('heading', { name: 'All events', exact: true })).toBeVisible();
    }
  });
}
