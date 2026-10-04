import { test, expect } from './fixtures';
import { defaultSettings } from '../../lib/discord/config';

export const coveredPages = ['/admin/discord'] as const;
const guildId = '811111111111111111';
const memberId = '822222222222222222';
const initialSettings = () => ({ ...defaultSettings(), guildId, websiteUrl: 'https://6md.eu' });

// The bot is a separate service: these tests deliberately verify saved / queued
// website state without pretending that Discord has applied an action.
test.beforeEach(async ({ db }) => {
  await db.discordIntegration.upsert({
    where: { id: 1 },
    create: { id: 1, revision: 1, appliedRevision: 0, settings: { settings: initialSettings(), retention: { mode: 'days', days: 7 } } },
    update: { revision: 1, appliedRevision: 0, settings: { settings: initialSettings(), retention: { mode: 'days', days: 7 } }, lastSeenAt: null, health: 'not_connected' },
  });
});

test('superadmin saves Discord settings and sees saved revision waiting for the bot', async ({ page, login, db }) => {
  await login();
  await page.goto('/admin');
  await page.getByRole('link', { name: 'Discord Bot Configure Discord integration, review moderation, and manage evidence' }).click();
  await expect(page.getByRole('heading', { name: 'Discord bot', exact: true })).toBeVisible();
  await expect(page.getByText('No recent contact', { exact: true })).toBeVisible();
  await page.getByLabel('Public website URL', { exact: true }).fill('https://6md.eu/discord-browser-test');
  const saved = page.waitForResponse(response => response.url().endsWith('/api/discord/config') && response.request().method() === 'PUT');
  await page.getByRole('button', { name: 'Save configuration', exact: true }).click();
  expect((await saved).status()).toBe(200);
  await expect(page.getByRole('status')).toContainText('Configuration saved. The bot must apply the new revision');
  await expect(page.getByText('Saved · revision 2, waiting for bot', { exact: true })).toBeVisible();
  const persisted = await db.discordIntegration.findUniqueOrThrow({ where: { id: 1 } });
  expect(persisted.revision).toBe(2);
  expect(persisted.appliedRevision).toBe(0);
  expect(persisted.settings).toMatchObject({ settings: { websiteUrl: 'https://6md.eu/discord-browser-test' } });
  await page.reload();
  await expect(page.getByLabel('Public website URL', { exact: true })).toHaveValue('https://6md.eu/discord-browser-test');
  await expect(page.getByRole('button', { name: 'Save configuration', exact: true })).toBeDisabled();
});

test('a member with no Discord grants cannot open the bot administration', async ({ page, login, db, seed }) => {
  const grants = await db.userPermission.findMany({ where: { userId: seed.memberId } });
  await db.userPermission.deleteMany({ where: { userId: seed.memberId } });
  try {
    await login('member');
    await page.goto('/admin/discord');
    await expect(page).not.toHaveURL(/\/admin\/discord$/);
    await expect(page.getByRole('heading', { name: 'Discord bot', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Save configuration', exact: true })).toHaveCount(0);
  } finally {
    if (grants.length) await db.userPermission.createMany({ data: grants });
  }
});

test('evidence-view delegation exposes evidence without deletion or configuration controls', async ({ page, login, db, seed }) => {
  const permission = await db.permission.findUniqueOrThrow({ where: { key: 'discord:evidence_view' } });
  const grant = await db.userPermission.create({ data: { userId: seed.memberId, permissionId: permission.id, value: 1 } });
  const occurredAt = new Date();
  const moderationCase = await db.discordModerationCase.create({ data: {
    triggerId: '833333333333333331', guildId, memberId, roleIds: [], configRevision: 1, configSnapshot: {},
    action: 'ban', status: 'applied', occurredAt,
  } });
  const evidence = await db.discordEvidence.create({ data: {
    caseId: moderationCase.id, messageId: '833333333333333332', channelId: '833333333333333333', authorId: memberId,
    sentAt: occurredAt, content: 'Restricted browser-test moderation evidence.', attachments: [],
    expiresAt: new Date(Date.now() + 7 * 86400000),
  } });
  try {
    await login('member');
    await page.goto('/admin/discord');
    await expect(page.getByText('You have read-only access to general configuration.', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Public website URL', { exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Save configuration', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Evidence', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Restricted moderation evidence', exact: true })).toBeVisible();
    await expect(page.getByText('Restricted browser-test moderation evidence.', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Delete evidence', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Restore evidence', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Keep indefinitely', exact: true })).toHaveCount(0);
    expect((await db.discordEvidence.findUniqueOrThrow({ where: { id: evidence.id } })).deletedAt).toBeNull();
  } finally {
    await db.userPermission.delete({ where: { id: grant.id } });
    await db.discordEvidence.delete({ where: { id: evidence.id } });
    await db.discordModerationCase.delete({ where: { id: moderationCase.id } });
  }
});

test('early timeout release queues an audited command and waits for bot confirmation', async ({ page, login, db }) => {
  const moderationCase = await db.discordModerationCase.create({ data: {
    triggerId: '844444444444444441', guildId, memberId: '844444444444444442', roleIds: ['844444444444444443'],
    configRevision: 1, configSnapshot: {}, action: 'timeout', status: 'applied', occurredAt: new Date(),
    timeoutUntil: new Date(Date.now() + 24 * 3600000),
  } });
  try {
    await login();
    await page.goto('/admin/discord');
    await page.getByRole('button', { name: 'Moderation', exact: true }).click();
    const caseCard = page.locator('article').filter({ hasText: `Member ${moderationCase.memberId}` });
    await expect(caseCard).toBeVisible();
    page.once('dialog', dialog => dialog.accept());
    const queued = page.waitForResponse(response => response.url().endsWith(`/api/discord/cases/${moderationCase.id}/release`) && response.request().method() === 'POST');
    await caseCard.getByRole('button', { name: 'Release timeout', exact: true }).click();
    expect((await queued).status()).toBe(202);
    await expect(page.getByRole('status')).toContainText('Timeout release queued; it takes effect when the bot confirms completion.');
    const command = await db.discordCommand.findFirstOrThrow({ where: { kind: 'timeout.release', payload: { path: ['caseId'], equals: moderationCase.id } } });
    expect(command.status).toBe('pending');
    expect(command.payload).toMatchObject({ caseId: moderationCase.id, memberId: moderationCase.memberId, guildId });
    expect((await db.discordModerationCase.findUniqueOrThrow({ where: { id: moderationCase.id } })).releasedAt).toBeNull();
    await page.getByRole('button', { name: 'Activity', exact: true }).click();
    await expect(page.locator('article').filter({ hasText: 'timeout.release' }).first()).toContainText('pending');
  } finally {
    await db.discordCommand.deleteMany({ where: { kind: 'timeout.release', payload: { path: ['caseId'], equals: moderationCase.id } } });
    await db.discordModerationCase.delete({ where: { id: moderationCase.id } });
  }
});

test('ORBAT announcement preview renders the roster image and explicit publication stays pending', async ({ page, login, db, seed }) => {
  await db.discordIntegration.update({ where: { id: 1 }, data: { settings: { settings: { ...initialSettings(), announcementsEnabled: true, announcementChannelId: '833333333333333333' }, retention: { mode: 'days', days: 7 } } } });
  await login();
  await page.goto(`/admin/orbats/${seed.orbatId}`);
  const panel = page.getByRole('region', { name: 'Discord announcement' });
  await expect(panel.getByLabel('Destination channel ID')).toHaveValue('833333333333333333');
  await panel.getByLabel('Mission message').fill('Pilot slot available for this mission.');
  await panel.getByText('Preview announcement', { exact: true }).click();
  const image = panel.getByRole('img');
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(1200);
  await panel.getByRole('button', { name: 'Announce to Discord', exact: true }).click();
  await expect(panel.getByText('Waiting for the bot to apply the queued announcement request.')).toBeVisible();
  const announcement = await db.discordAnnouncement.findUniqueOrThrow({ where: { orbatId: seed.orbatId } });
  expect(announcement.messageId).toBeNull();
  expect(announcement.missionText).toBe('Pilot slot available for this mission.');
  expect(await db.discordCommand.count({ where: { kind: 'announcement.publish', status: 'pending', payload: { path: ['orbatId'], equals: seed.orbatId } } })).toBe(1);
});

test('Discord administration hydrates with Refresh disabled until configuration loads', async ({ page, login }) => {
  await login();
  const hydrationErrors: string[] = [];
  page.on('console', message => {
    if (/hydration|hydrated|server rendered HTML/i.test(message.text())) hydrationErrors.push(message.text());
  });
  let releaseConfiguration!: () => void;
  const configurationGate = new Promise<void>(resolve => { releaseConfiguration = resolve; });
  await page.route('**/api/discord/config', async route => {
    await configurationGate;
    await route.continue();
  });
  try {
    const response = await page.goto('/admin/discord');
    const html = await response!.text();
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Refresh<\/button>/);
    await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeDisabled();
  } finally {
    releaseConfiguration();
  }
  await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled();
  expect(hydrationErrors).toEqual([]);
});

test('bot reports show exhausted join-role failures separately from queued actions', async ({ page, login, db }) => {
  const operation = await db.discordOperation.create({ data: {
    eventId: 'browser-join-role-failure', guildId, configRevision: 1, kind: 'join.roles',
    status: 'failed', attempts: 3, memberId, errorCode: 'role_hierarchy', occurredAt: new Date(),
  } });
  try {
    await login();
    await page.goto('/admin/discord');
    await page.getByRole('button', { name: 'Bot reports', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Automatic bot operations' })).toBeVisible();
    await expect(page.getByText('role_hierarchy', { exact: true })).toBeVisible();
    await expect(page.getByText(`3 attempt(s) · Member ${memberId}`, { exact: false })).toBeVisible();
  } finally {
    await db.discordOperation.delete({ where: { id: operation.id } });
  }
});

test('diagnostics show incompatible schemas and missing Discord capabilities', async ({page, login, db}) => {
  await db.discordIntegration.update({where: {id: 1}, data: {
    metadataObservedAt: new Date(), diagnosticsReportedAt: new Date(),
    diagnostics: {configRevision: 1, supportedSchemaVersions: [2], pendingCount: 1, failedCount: 2,
      issues: [{code: 'role_hierarchy', severity: 'error', field: 'defaultRoleIds'}], permissions: [{capability: 'manage_roles', granted: false}]},
  }});
  await login();
  await page.goto('/admin/discord');
  await expect(page.getByRole('heading', {name: 'Bot diagnostics'})).toBeVisible();
  await expect(page.getByText('The bot does not support this configuration schema.', {exact: false})).toBeVisible();
  await expect(page.getByText('error: role_hierarchy · defaultRoleIds')).toBeVisible();
  await page.getByText('Discord permissions and capabilities', {exact: true}).click();
  await expect(page.getByText('manage_roles: Missing')).toBeVisible();
});

test('bulk role changes queue a preview before offering confirmation', async ({page, login, db}) => {
  await db.discordIntegration.update({where: {id: 1}, data: {settings: {settings: {...initialSettings(), defaultRoleIds: ['844444444444444444']}, retention: {mode: 'days', days: 7}}}});
  await login();
  await page.goto('/admin/discord');
  await page.getByRole('button', {name: 'Bulk roles', exact: true}).click();
  await page.getByRole('button', {name: 'Preview default role assignment'}).click();
  await expect(page.getByRole('status')).toContainText('Preview queued.');
  await expect(page.getByRole('button', {name: 'Confirm reviewed changes'})).toHaveCount(0);
  expect(await db.discordCommand.count({where: {kind: 'bulk.preview'}})).toBeGreaterThan(0);
  expect(await db.discordCommand.count({where: {kind: 'bulk.execute'}})).toBe(0);
});
