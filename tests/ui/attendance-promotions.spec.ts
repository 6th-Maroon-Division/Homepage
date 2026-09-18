import { test, expect } from './fixtures';

export const coveredPages = ['/admin/attendance', '/admin/promotions', '/admin/ranks/migrate'] as const;

test('legacy attendance matrix previews without writes, imports UTC dates and maps every record', async ({ page, login, db }) => {
  const user = await db.user.create({ data: { username: 'UI Matrix Mapped Member' } });
  await login();
  await page.goto('/admin/attendance');
  await page.getByRole('button', { name: 'Legacy Import', exact: true }).click();
  await page.getByRole('button', { name: 'Import Attendance CSV', exact: true }).click();
  await page.getByPlaceholder('Paste attendance matrix CSV data here...').fill('YEAR: 2025\nRANK,NAME,ID,26-Dec,2-Jan,9-Jan\nPvt,UI Matrix Legacy,ui-matrix-import,P,A,LOA');
  const preview = page.waitForResponse(r => r.url().endsWith('/api/attendance/legacy-records/import') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Preview (skip LOA/NO/EO)', exact: true }).click();
  expect((await preview).ok()).toBeTruthy();
  await expect(page.getByText('Preview (2 records) — already skipping LOA/NO/EO', { exact: true })).toBeVisible();
  expect(await db.legacyAttendanceData.count({ where: { legacyUserId: 'ui-matrix-import' } })).toBe(0);
  const imported = page.waitForResponse(r => r.url().endsWith('/api/attendance/legacy-records/import') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Save to Database', exact: true }).click();
  expect((await imported).ok()).toBeTruthy();
  await expect(page.getByText('Pvt UI Matrix Legacy', { exact: true })).toBeVisible();
  const records = await db.legacyAttendanceData.findMany({ where: { legacyUserId: 'ui-matrix-import' }, orderBy: { legacyEventDate: 'asc' } });
  expect(records.map(record => [record.legacyStatus, record.legacyEventDate?.toISOString()])).toEqual([
    ['P', '2024-12-26T00:00:00.000Z'], ['A', '2025-01-02T00:00:00.000Z'],
  ]);
  await page.getByText('Pvt UI Matrix Legacy', { exact: true }).locator('..').locator('..').getByRole('button', { name: 'Map', exact: true }).click();
  await page.getByPlaceholder('Search users...').fill(user.username!);
  await page.locator('select').filter({ has: page.locator('option', { hasText: '-- Select User --' }) }).selectOption(String(user.id));
  await page.getByRole('button', { name: 'Save Mapping', exact: true }).click();
  await expect(page.getByText(`✓ Mapped to: ${user.username}`, { exact: true })).toBeVisible();
  expect(await db.legacyAttendanceData.count({ where: { legacyUserId: 'ui-matrix-import', mappedUserId: user.id, isMapped: true } })).toBe(2);
});

test('legacy user CSV previews and imports a historical baseline then maps it to a local account', async ({ page, login, db }) => {
  const user = await db.user.create({ data: { username: 'UI Baseline Mapped Member' } });
  await login();
  await page.goto('/admin/attendance');
  await page.getByRole('button', { name: 'Legacy Import', exact: true }).click();
  await page.getByRole('button', { name: 'Import User Data CSV', exact: true }).click();
  await page.getByPlaceholder('Paste user data CSV here...').fill('ID,NAME,Rank,Date Joined,TIG Since Last Promo,TOTAL TIG,Old Data\nui-baseline-import,UI Baseline Legacy,Pvt,2020-01-02,3,8,5');
  const preview = page.waitForResponse(r => r.url().endsWith('/api/attendance/legacy-users/import') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  expect((await preview).ok()).toBeTruthy();
  await expect(page.getByText('Preview (1 records)', { exact: true })).toBeVisible();
  expect(await db.legacyUserData.count({ where: { legacyId: 'ui-baseline-import' } })).toBe(0);
  const imported = page.waitForResponse(r => r.url().endsWith('/api/attendance/legacy-users/import') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Save to Database', exact: true }).click();
  expect((await imported).ok()).toBeTruthy();
  await expect(page.getByText('UI Baseline Legacy (Pvt)', { exact: true })).toBeVisible();
  expect(await db.legacyUserData.findFirstOrThrow({ where: { legacyId: 'ui-baseline-import' } })).toMatchObject({ dateJoined: '2020-01-02', tigSinceLastPromo: 3, totalTig: 8, oldData: 5, isApplied: false });
  await page.getByText('UI Baseline Legacy (Pvt)', { exact: true }).locator('..').locator('..').getByRole('button', { name: 'Map', exact: true }).click();
  await page.getByPlaceholder('Search users...').fill(user.username!);
  await page.locator('select').filter({ has: page.locator('option', { hasText: '-- Select User --' }) }).selectOption(String(user.id));
  await page.getByRole('button', { name: 'Save Mapping', exact: true }).click();
  await expect(page.getByText(`✓ Mapped to: ${user.username}`, { exact: true })).toBeVisible();
  expect(await db.legacyUserData.findFirstOrThrow({ where: { legacyId: 'ui-baseline-import' } })).toMatchObject({ mappedUserId: user.id, isMapped: true, isApplied: false });
});

test('populated promotion queue approves and declines members with persisted rank history', async ({ page, login, db }) => {
  const low = await db.rank.create({ data: { name: 'UI Decision Private', abbreviation: 'UIDP', orderIndex: 50000 } });
  const high = await db.rank.create({ data: { name: 'UI Decision Corporal', abbreviation: 'UIDC', orderIndex: 50001 } });
  const targets = [];
  for (const outcome of ['approved', 'declined'] as const) {
    const user = await db.user.create({ data: { username: `UI Promotion ${outcome}` } });
    await db.userRank.create({ data: { userId: user.id, currentRankId: low.id, interviewDone: true } });
    const proposal = await db.promotionProposal.create({ data: { userId: user.id, currentRankId: low.id, nextRankId: high.id, attendanceTotalAtProposal: 0, attendanceDeltaSinceLastRank: 0, status: 'pending' } });
    targets.push({ outcome, user, proposal });
  }
  await login();
  await page.goto('/admin/promotions');
  for (const { outcome, user, proposal } of targets) {
    const row = page.getByRole('row').filter({ hasText: user.username! });
    await expect(row).toContainText('UIDP');
    await expect(row).toContainText('UIDC');
    const decision = outcome === 'approved' ? 'approve' : 'decline';
    const saved = page.waitForResponse(r => r.url().endsWith(`/api/ranks/promotions/${proposal.id}/${decision}`) && r.request().method() === 'POST');
    if (outcome === 'declined') page.once('dialog', dialog => dialog.accept('Needs another training session'));
    await row.getByRole('button', { name: outcome === 'approved' ? 'Approve' : 'Decline', exact: true }).click();
    expect((await saved).ok()).toBeTruthy();
    await expect(row).toHaveCount(0);
    expect((await db.promotionProposal.findUniqueOrThrow({ where: { id: proposal.id } })).status).toBe(outcome);
    expect((await db.userRank.findUniqueOrThrow({ where: { userId: user.id } })).currentRankId).toBe(outcome === 'approved' ? high.id : low.id);
    const history = await db.rankHistory.findFirstOrThrow({ where: { userId: user.id } });
    expect(history.outcome).toBe(outcome);
    if (outcome === 'declined') expect(history.declineReason).toBe('Needs another training session');
  }
  await page.reload();
  for (const { user } of targets) await expect(page.getByRole('row').filter({ hasText: user.username! })).toHaveCount(0);
});

test('rank migration mapping previews, confirms and applies a real rank change', async ({ page, login, db, seed }) => {
  const permission = await db.permission.upsert({ where: { key: 'rank:edit' }, create: { key: 'rank:edit', maxValue: 255 }, update: {} });
  await db.userPermission.upsert({ where: { userId_permissionId: { userId: seed.adminId, permissionId: permission.id } }, create: { userId: seed.adminId, permissionId: permission.id, value: 255 }, update: { value: 255 } });
  const low = await db.rank.create({ data: { name: 'UI Migration Recruit', abbreviation: 'UIMR', orderIndex: 60000 } });
  const high = await db.rank.create({ data: { name: 'UI Migration Private', abbreviation: 'UIMP', orderIndex: 60001 } });
  const user = await db.user.create({ data: { username: 'UI Migration Mapped Member' } });
  await db.userRank.create({ data: { userId: user.id, currentRankId: low.id } });
  await login();
  await page.goto('/admin/ranks/migrate');
  await page.getByRole('button', { name: 'I Have a Backup - Proceed', exact: true }).click();
  await page.getByRole('radio', { name: /Map Old Ranks to New Ranks/ }).check();
  await page.getByRole('button', { name: 'Next: Configure Mappings', exact: true }).click();
  await page.getByRole('combobox', { name: 'New rank for UIMR - UI Migration Recruit', exact: true }).selectOption(String(high.id));
  const preview = page.waitForResponse(r => r.url().endsWith('/api/ranks/migrate/preview') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Next: Preview Changes', exact: true }).click();
  expect((await preview).ok()).toBeTruthy();
  await expect(page.getByText(user.username!, { exact: true })).toBeVisible();
  expect((await db.userRank.findUniqueOrThrow({ where: { userId: user.id } })).currentRankId).toBe(low.id);
  page.once('dialog', dialog => dialog.accept());
  const applied = page.waitForResponse(r => r.url().endsWith('/api/ranks/migrate/apply') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Apply Migration', exact: true }).click();
  expect((await applied).ok()).toBeTruthy();
  await expect(page.getByText('Migration Applied Successfully', { exact: true })).toBeVisible();
  expect((await db.userRank.findUniqueOrThrow({ where: { userId: user.id } })).currentRankId).toBe(high.id);
  expect(await db.rankHistory.findFirstOrThrow({ where: { userId: user.id } })).toMatchObject({ previousRankName: low.name, newRankName: high.name, triggeredByUserId: seed.adminId });
});
