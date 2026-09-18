import { test, expect } from './fixtures';

for (const [timezoneId, localDate, localTime] of [
  ['America/Los_Angeles', 'Jul 19, 2099', '05:30 PM'],
  ['Europe/Berlin', 'Jul 20, 2099', '02:30 AM'],
] as const) {
  test.describe(`operation date display in ${timezoneId}`, () => {
    test.use({ timezoneId, locale: 'en-US' });

    test('untimed dates retain their day while timed operations use the viewer timezone', async ({ page, login, db, seed }) => {
      const calendarDate = '2099-07-20';
      const instant = '2099-07-20T00:30:00.000Z';
      const untimed = await db.orbat.create({ data: {
        name: `Calendar date ${timezoneId}`, eventDate: new Date(`${calendarDate}T00:00:00.000Z`),
        startsAtUtc: null, createdById: seed.adminId,
      } });
      const timed = await db.orbat.create({ data: {
        name: `Local instant ${timezoneId}`, eventDate: new Date(instant),
        startsAtUtc: new Date(instant), createdById: seed.adminId,
      } });
      const hydrationErrors: string[] = [];
      page.on('console', message => {
        if (/hydration|hydrated.*match/i.test(message.text())) hydrationErrors.push(message.text());
      });
      page.on('pageerror', error => {
        if (/hydration|hydrated.*match/i.test(error.message)) hydrationErrors.push(error.message);
      });

      await page.goto('/orbats');
      const calendarUntimed = page.getByRole('listitem').filter({ has: page.getByRole('button', { name: untimed.name, exact: true }) });
      const calendarTimed = page.getByRole('listitem').filter({ has: page.getByRole('button', { name: timed.name, exact: true }) });
      await expect(calendarUntimed.locator('time')).toHaveText('Jul 20, 2099');
      await expect(calendarTimed.locator('time').nth(0)).toHaveText(localDate);
      await expect(calendarTimed.locator('time').nth(1)).toHaveText(localTime);

      // Verify the public view before authenticating, then the admin detail view.
      for (const prefix of ['/orbats', '/admin/orbats']) {
        if (prefix === '/admin/orbats') await login();
        await page.goto(`${prefix}/${untimed.id}`);
        await expect(page.locator(`time[datetime="${calendarDate}"]`)).toHaveText('Jul 20, 2099');
        await page.goto(`${prefix}/${timed.id}`);
        const display = page.locator(`time[datetime="${instant}"]`);
        await expect(display.nth(0)).toHaveText(localDate);
        await expect(display.nth(1)).toHaveText(localTime);
      }

      await page.goto('/admin/attendance');
      await expect(page.getByRole('link', { name: new RegExp(untimed.name) }).locator('time')).toHaveText('Jul 20, 2099');
      await expect(page.getByRole('link', { name: new RegExp(timed.name) }).locator('time')).toHaveText(localDate);
      expect(hydrationErrors).toEqual([]);
    });
  });
}
