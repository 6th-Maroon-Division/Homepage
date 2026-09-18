import { test, expect } from './fixtures';

for (const viewport of [{ name: 'mobile', width: 390, height: 844 }, { name: 'desktop', width: 1440, height: 1000 }]) {
  test.describe(`${viewport.name} layout`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });
    test('public briefing and signup layout remain usable', async ({ page, db, seed }) => {
      const operation = await db.orbat.create({ data: { name: 'Responsive Operation', description: 'A stable briefing for automated layout checks.', createdById: seed.adminId, startsAtUtc: new Date('2099-07-20T17:00:00Z'), eventDate: new Date('2099-07-20T17:00:00Z') } });
      const squad = await db.squad.create({ data: { orbatId: operation.id, name: 'Responsive Alpha', orderIndex: 0 } });
      await db.slot.create({ data: { orbatId: operation.id, squadId: squad.id, squadRoleId: seed.roleId, maxSignups: 1, orderIndex: 0 } });
      await page.goto(`/orbats/${operation.id}`);
      await expect(page.getByRole('heading', { name: 'Responsive Operation', exact: true })).toBeVisible();
      await expect(page.getByText('Browser Rifleman', { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Sign up', exact: true })).toHaveCount(0);
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await expect(page.locator('main')).toHaveScreenshot(`operation-${viewport.name}.png`, { animations: 'disabled' });
    });
    test('member profile navigation and admin form fit the viewport', async ({ page, login }) => {
      await login('member');
      await page.goto('/profile');
      await page.getByRole('button', { name: 'Notifications', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Notification preferences', exact: true })).toBeVisible();
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await login();
      await page.goto('/admin/orbats/new');
      await page.locator('#name').fill('Responsive Form');
      await page.getByRole('button', { name: '+ Add Slot', exact: true }).click();
      await page.getByPlaceholder('e.g., Command Element, Rifle Platoon').fill('Mobile Alpha');
      await expect(page.getByPlaceholder('e.g., Command Element, Rifle Platoon')).toHaveValue('Mobile Alpha');
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    });
  });
}
