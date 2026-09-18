import { test, expect } from './fixtures';

for (const source of ['template', 'orbat'] as const) {
  test(`new operation loads ${source} roles and saves a complete independent copy`, async ({ page, login, seed, db }) => {
    const roles = await Promise.all([
      db.squadRole.create({ data: { name: `UI ${source} Preset Leader` } }),
      db.squadRole.create({ data: { name: `UI ${source} Preset Medic` } }),
    ]);
    const name = `UI ${source} Source Operation`;
    const squads = roles.map((role, index) => ({
      name: `Preset Squad ${index + 1}`,
      orderIndex: index,
      slots: [{ squadRoleId: role.id, name: role.name, orderIndex: 0, maxSignups: index + 2 }],
    }));
    let sourceId: number;
    let originalSlotId: number | undefined;
    if (source === 'template') {
      const template = await db.orbatTemplate.create({ data: { name, createdById: seed.adminId, frequencyIds: [], slotsJson: squads } });
      sourceId = template.id;
    } else {
      // The recent-preset API sorts by descending ID, so this newest record
      // remains in its five-item list regardless of operation dates.
      const original = await db.orbat.create({ data: { name, createdById: seed.adminId, startsAtUtc: new Date('2099-10-01T17:00:00Z') } });
      sourceId = original.id;
      for (const squad of squads) {
        const created = await db.squad.create({ data: { name: squad.name, orderIndex: squad.orderIndex, orbatId: original.id } });
        const slot = await db.slot.create({ data: { orbatId: original.id, squadId: created.id, squadRoleId: squad.slots[0].squadRoleId, orderIndex: 0, maxSignups: squad.slots[0].maxSignups } });
        originalSlotId ??= slot.id;
      }
      await db.signup.create({ data: { slotId: originalSlotId!, userId: seed.memberId } });
    }

    await login();
    await page.goto('/admin/orbats/new');
    const loader = page.locator('select').filter({ has: page.locator(`option[value="${source}-${sourceId}"]`) });
    await loader.selectOption(`${source}-${sourceId}`);
    await page.getByRole('button', { name: 'Load Template', exact: true }).click();
    await expect(page.getByLabel('Name', { exact: false }).first()).toHaveValue(`${name} - Copy`);
    for (const [index, role] of roles.entries()) {
      const roleRow = page.getByText(role.name, { exact: true }).locator('..').filter({ has: page.getByRole('spinbutton') });
      await expect(roleRow).toBeVisible();
      await expect(roleRow.getByRole('spinbutton')).toHaveValue(String(index + 2));
    }
    await page.locator('#eventDate').fill('2099-10-02');
    const saved = page.waitForResponse(response => response.url().endsWith('/api/orbats') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Create OrbAT', exact: true }).click();
    const response = await saved;
    expect(response.status()).toBe(201);
    const { data: { id } } = await response.json();
    await expect(page).toHaveURL(new RegExp(`/orbats/${id}$`));
    await expect(page.getByRole('heading', { name: `${name} - Copy`, exact: true })).toBeVisible();
    for (const role of roles) await expect(page.getByText(role.name, { exact: true })).toBeVisible();
    const copy = await db.orbat.findUniqueOrThrow({ where: { id }, include: { squads: { orderBy: { orderIndex: 'asc' }, include: { slots: { orderBy: { orderIndex: 'asc' }, include: { signups: true } } } } } });
    expect(copy.squads).toHaveLength(2);
    for (const [index, squad] of copy.squads.entries()) {
      expect(squad.name).toBe(squads[index].name);
      expect(squad.slots).toHaveLength(1);
      expect(squad.slots[0]).toMatchObject({ squadRoleId: roles[index].id, maxSignups: index + 2, signups: [] });
      if (originalSlotId) expect(squad.slots[0].id).not.toBe(originalSlotId);
    }
    if (originalSlotId) expect(await db.signup.count({ where: { slotId: originalSlotId, userId: seed.memberId } })).toBe(1);
  });
}
