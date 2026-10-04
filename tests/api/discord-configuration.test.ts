import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PermissionKey } from '@/lib/permissions';
const mocks = vi.hoisted(() => {
  const model = () => ({ create: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), upsert: vi.fn(), update: vi.fn(), updateMany: vi.fn() });
  return { session: vi.fn(), audit: vi.fn(), db: { botEvent: { create: vi.fn(), deleteMany: vi.fn() }, $transaction: vi.fn(), user: model(), botToken: model(), discordIntegration: model(), discordConfigurationRevision: model(), discordEvidence: model(), rankDiscordRole: model() } };
});
vi.mock('@/lib/prisma', () => ({ prisma: mocks.db }));
vi.mock('next-auth', () => ({ getServerSession: mocks.session }));
vi.mock('@/app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
vi.mock('@/lib/api/audit', () => ({ writeApiAudit: mocks.audit }));
import { GET as history } from '@/app/api/discord/config/history/route';
import { GET, PUT } from '@/app/api/discord/config/route';
import { PATCH } from '@/app/api/discord/retention/route';
import { POST } from '@/app/api/discord/heartbeat/route';
import { classifyMember, defaultSettings, parseRetention, parseSettings } from '@/lib/discord/config';
const guildId = '111111111111111111';
const roleId = '222222222222222222';
const otherRoleId = '333333333333333333';
const settings = () => ({ ...defaultSettings(), guildId, websiteUrl: 'https://6md.eu' });
const stored = (days = 7) => ({ id: 1, revision: 4, appliedRevision: 3, settings: { settings: settings(), retention: { mode: 'days', days } }, metadata: null, lastSeenAt: null, health: 'degraded', botVersion: '0.1' });
const req = (path = 'config', method = 'GET', body?: unknown, token?: string) => new Request(`http://localhost/api/discord/${path}`, { method, headers: token ? { authorization: token } : {}, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
const grant = (...keys: PermissionKey[]) => {
  mocks.session.mockResolvedValue({ user: { id: 8 } });
  mocks.db.user.findUnique.mockResolvedValue({ userPermissions: keys.map(key => ({ value: 1, permission: { key } })) });
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue(null);
  mocks.db.botToken.findFirst.mockResolvedValue({ id: 7 });
  mocks.db.discordIntegration.findUnique.mockResolvedValue(stored());
  mocks.db.discordIntegration.upsert.mockResolvedValue({ ...stored(), revision: 5 });
  mocks.db.discordIntegration.update.mockResolvedValue({ ...stored(), appliedRevision: 4 });
  mocks.db.rankDiscordRole.findMany.mockResolvedValue([]);
  mocks.db.discordEvidence.findMany.mockResolvedValue([]);
  mocks.db.$transaction.mockImplementation(async fn => fn(mocks.db));
  grant('discord:configure');
});

describe('Discord configuration validation and honeypot classification', () => {
  it('accepts disabled bootstrap defaults without requiring Discord IDs', () => expect(parseSettings(defaultSettings()).data).toBeDefined());
  it.each([
    ['unknown credentials', { discordToken: 'secret' }],
    ['invalid guild', { guildId: '42' }],
    ['timeout below one day', { timeoutHours: 23 }],
    ['timeout above Discord limit', { timeoutHours: 673 }],
    ['unsafe website URL', { websiteUrl: 'javascript:alert(1)' }],
    ['URL credentials', { websiteUrl: 'https://user:password@example.com' }],
    ['missing rank placeholder', { nicknameFormat: '{name}' }],
    ['too few retry steps', { retryDelays: '5,10' }],
    ['negative retry', { retryDelays: '5,15,60,300,-1' }],
    ['stale before poll', { freshnessSeconds: 60, pollSeconds: 120 }],
    ['duplicate role IDs', { defaultRoleIds: [roleId, roleId] }],
    ['membership/default collision', { defaultRoleIds: [roleId], membershipRoleIds: [roleId] }],
    ['enabled welcome without channel', { welcomeEnabled: true }],
    ['honeypot without membership roles', { honeypotEnabled: true, honeypotChannelId: roleId, staffLogChannelId: otherRoleId }],
  ])('rejects %s', (_, patch) => expect(parseSettings({ ...settings(), ...patch }).error).toBeTruthy());
  it('rejects reaction roles overlapping staff/default/membership roles or another menu', () => {
    const menu = { id: 'games', title: 'Games', description: '', channelId: guildId, singleChoice: false, entries: [{ emoji: '🎲', label: 'Game', roleId }] };
    expect(parseSettings({ ...settings(), menus: [menu] }).data).toBeDefined();
    for (const patch of [{ defaultRoleIds: [roleId] }, { membershipRoleIds: [roleId] }, { exemptRoleIds: [roleId] }, { recruiterRoleId: roleId }]) expect(parseSettings({ ...settings(), ...patch, menus: [menu] }).error).toBeTruthy();
    expect(parseSettings({ ...settings(), menus: [menu, { ...menu, id: 'other' }] }).error).toBeTruthy();
    expect(parseSettings({ ...settings(), menus: [{ ...menu, entries: [...menu.entries, { emoji: '🎲', label: 'Duplicate emoji', roleId: otherRoleId }] }] }).error).toBeTruthy();
  });
  it('uses only configured membership roles, with exemptions taking priority', () => {
    const config = { ...settings(), membershipRoleIds: [roleId], exemptRoleIds: [otherRoleId], exemptUserIds: ['444444444444444444'] };
    expect(classifyMember(config, guildId, [])).toBe('ban');
    expect(classifyMember(config, guildId, ['555555555555555555'])).toBe('ban');
    expect(classifyMember(config, guildId, [roleId])).toBe('timeout');
    expect(classifyMember(config, guildId, [roleId, otherRoleId])).toBe('exempt');
    expect(classifyMember(config, '444444444444444444', [])).toBe('exempt');
  });
  it('requires explicit valid finite or indefinite retention', () => {
    expect(parseRetention({ mode: 'days', days: 7 })).toEqual({ mode: 'days', days: 7 });
    expect(parseRetention({ mode: 'indefinite', days: null })).toEqual({ mode: 'indefinite', days: null });
    for (const invalid of [{ mode: 'days', days: 6 }, { mode: 'days', days: '7' }, { mode: 'indefinite', days: 7 }, { mode: 'days', days: 7, purge: true }]) expect(parseRetention(invalid)).toBeNull();
  });
});

describe('Discord configuration route access and revision safety', () => {
  it('rejects anonymous and unprivileged users before reading configuration', async () => {
    mocks.session.mockResolvedValue(null);
    expect((await GET(req())).status).toBe(401);
    grant();
    expect((await GET(req())).status).toBe(403);
    expect(mocks.db.discordIntegration.findUnique).not.toHaveBeenCalled();
  });
  it('allows independently delegated Discord grants but hides retention without evidence access', async () => {
    grant('discord:timeout_release');
    const response = await GET(req());
    expect(response.status).toBe(200);
    expect((await response.json()).data).not.toHaveProperty('retention');
    grant('discord:evidence_view');
    expect((await (await GET(req())).json()).data.retention).toEqual({ mode: 'days', days: 7 });
  });
  it('uses safe defaults for a new deployment', async () => {
    mocks.db.discordIntegration.findUnique.mockResolvedValue(null);
    const { data } = await (await GET(req())).json();
    expect(data).toMatchObject({ revision: 0, appliedRevision: 0, settings: defaultSettings(), lastSeenAt: null, metadata: null, health: 'not_connected' });
  });
  it('does not let evidence retention permission edit operational configuration', async () => {
    grant('discord:evidence_retention');
    expect((await PUT(req('config', 'PUT', { revision: 4, settings: settings() }))).status).toBe(403);
    expect(mocks.db.discordIntegration.upsert).not.toHaveBeenCalled();
  });
  it('allows superadmin and audits a successful configuration revision', async () => {
    grant('system:super_admin');
    const response = await PUT(req('config', 'PUT', { revision: 4, settings: settings() }));
    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual({ revision: 5, appliedRevision: 3 });
    expect(mocks.db.botEvent.create).toHaveBeenCalledWith({data:{type:'discord.configuration.changed',aggregate:'discord',aggregateId:'1',payload:{revision:5}}});
    expect(mocks.db.discordIntegration.upsert.mock.lastCall![0].update).toMatchObject({ revision: { increment: 1 } });
    expect(mocks.audit).toHaveBeenCalledWith(mocks.db, expect.anything(), expect.objectContaining({ action: 'discord.configuration.updated' }));
  });
  it('rejects stale edits and never writes or advances their revision', async () => {
    expect((await PUT(req('config', 'PUT', { revision: 3, settings: settings() }))).status).toBe(409);
    expect(mocks.db.discordIntegration.upsert).not.toHaveBeenCalled();
  });
  it('rejects changing an established guild', async () => {
    expect((await PUT(req('config', 'PUT', { revision: 4, settings: { ...settings(), guildId: roleId } }))).status).toBe(409);
    expect(mocks.db.discordIntegration.upsert).not.toHaveBeenCalled();
  });
  it('prevents assigning managed rank roles through reaction menus', async () => {
    mocks.db.rankDiscordRole.findMany.mockResolvedValue([{ discordRoleId: roleId }]);
    expect((await PUT(req('config', 'PUT', { revision: 4, settings: { ...settings(), menus: [{ id: 'rank', title: 'Rank', description: '', channelId: guildId, singleChoice: false, entries: [{ emoji: '🎖️', label: 'Rank', roleId }] }] } }))).status).toBe(422);
    expect(mocks.db.discordIntegration.upsert).not.toHaveBeenCalled();
  });
  it('rejects unknown fields and query parameters', async () => {
    expect((await GET(req('config?extra=1'))).status).toBe(400);
    expect((await PUT(req('config', 'PUT', { revision: 4, settings: settings(), token: 'secret' }))).status).toBe(422);
    expect(mocks.db.discordIntegration.upsert).not.toHaveBeenCalled();
  });
  it('maps serialization races to a conflict response', async () => {
    mocks.db.$transaction.mockRejectedValue({ code: 'P2034' });
    expect((await PUT(req('config', 'PUT', { revision: 4, settings: settings() }))).status).toBe(409);
  });
});

describe('Discord retention policy route', () => {
  it('requires the dedicated grant even for general configurators', async () => {
    expect((await PATCH(req('retention', 'PATCH', { revision: 4, retention: { mode: 'days', days: 14 } }))).status).toBe(403);
  });
  it('rejects retention below seven days without mutation', async () => {
    grant('discord:evidence_retention');
    expect((await PATCH(req('retention', 'PATCH', { revision: 4, retention: { mode: 'days', days: 6 } }))).status).toBe(422);
    expect(mocks.db.discordIntegration.upsert).not.toHaveBeenCalled();
  });
  it('shortens policy for new evidence without changing existing records', async () => {
    grant('discord:evidence_retention'); mocks.db.discordIntegration.findUnique.mockResolvedValue(stored(30));
    expect((await PATCH(req('retention', 'PATCH', { revision: 4, retention: { mode: 'days', days: 7 } }))).status).toBe(200);
    expect(mocks.db.discordEvidence.findMany).not.toHaveBeenCalled();
    expect(mocks.db.discordEvidence.updateMany).not.toHaveBeenCalled();
    expect(mocks.db.discordEvidence.update).not.toHaveBeenCalled();
  });
  it('extends existing finite evidence without shortening longer individual retention', async () => {
    grant('discord:evidence_retention');
    const capturedAt = new Date('2026-01-01T00:00:00Z');
    mocks.db.discordEvidence.findMany.mockResolvedValueOnce([{ id: 1, capturedAt, expiresAt: new Date('2026-01-08T00:00:00Z') }, { id: 2, capturedAt, expiresAt: new Date('2026-03-01T00:00:00Z') }]).mockResolvedValueOnce([]);
    expect((await PATCH(req('retention', 'PATCH', { revision: 4, retention: { mode: 'days', days: 14 } }))).status).toBe(200);
    expect(mocks.db.discordEvidence.update).toHaveBeenCalledTimes(1);
    expect(mocks.db.discordEvidence.update).toHaveBeenCalledWith({ where: { id: 1 }, data: { expiresAt: new Date('2026-01-15T00:00:00Z'), version: { increment: 1 } } });
    expect(mocks.db.discordEvidence.findMany.mock.calls[1][0].where.id).toEqual({ gt: 2 });
  });
  it('marks existing active evidence indefinite without resurrecting deleted records', async () => {
    grant('discord:evidence_retention');
    expect((await PATCH(req('retention', 'PATCH', { revision: 4, retention: { mode: 'indefinite', days: null } }))).status).toBe(200);
    expect(mocks.db.discordEvidence.updateMany).toHaveBeenCalledWith({ where: { deletedAt: null, purgedAt: null }, data: { indefinite: true, expiresAt: null, version: { increment: 1 } } });
  });
});

describe('Discord bot heartbeat route', () => {
  const heartbeat = () => ({ guildId, appliedRevision: 4, botVersion: '1.0', health: 'healthy', metadata: { roles: [{ id: roleId, name: 'Regulars', manageable: true }], channels: [] } });
  it('rejects even a superadmin browser session', async () => {
    grant('system:super_admin');
    expect((await POST(req('heartbeat', 'POST', heartbeat()))).status).toBe(403);
    expect(mocks.db.discordIntegration.update).not.toHaveBeenCalled();
  });
  it('accepts a live bot token and reports applied revision', async () => {
    const response = await POST(req('heartbeat', 'POST', heartbeat(), 'Bearer valid'));
    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual({ revision: 4, appliedRevision: 4 });
    expect(mocks.db.discordIntegration.update.mock.lastCall![0].data).toMatchObject({ appliedRevision: 4, health: 'healthy', metadata: heartbeat().metadata });
    expect(mocks.session).not.toHaveBeenCalled();
  });
  it('never falls back to a privileged session for a revoked token', async () => {
    grant('system:super_admin'); mocks.db.botToken.findFirst.mockResolvedValue(null);
    expect((await POST(req('heartbeat', 'POST', heartbeat(), 'Bearer revoked'))).status).toBe(401);
    expect(mocks.session).not.toHaveBeenCalled();
  });
  it.each([
    ['future revision', { appliedRevision: 5 }, 422],
    ['different guild', { guildId: roleId }, 409],
    ['unrecognized health', { health: 'ok' }, 422],
    ['metadata missing manageability', { metadata: { roles: [{ id: roleId, name: 'Regulars' }], channels: [] } }, 422],
    ['metadata with private data', { metadata: { roles: [], channels: [], token: 'secret' } }, 422],
  ])('rejects %s', async (_, patch, status) => {
    expect((await POST(req('heartbeat', 'POST', { ...heartbeat(), ...patch }, 'Bearer valid'))).status).toBe(status);
    expect(mocks.db.discordIntegration.update).not.toHaveBeenCalled();
  });
});

describe('Discord configuration malformed inputs and startup recovery', () => {
  it.each([
    ['non-string name format', { nicknameFormat: null }],
    ['malformed URL', { websiteUrl: 'not a URL' }],
    ['missing menu collection', { menus: undefined }],
    ['too many menus', { menus: Array.from({ length: 26 }, () => ({})) }],
    ['malformed category', { menus: [{ title: 'Games' }] }],
    ['enabled announcement without destination', { announcementsEnabled: true }],
    ['enabled feature without server', { guildId: '', rankRoleSync: true }],
    ['enabled feature without website', { websiteUrl: '', rankRoleSync: true }],
  ])('rejects %s', (_, patch) => {
    expect(parseSettings({ ...settings(), ...patch }).error).toBeTruthy();
  });
  it('rejects a missing expected revision before beginning a write', async () => {
    expect((await PUT(req('config', 'PUT', { settings: settings() }))).status).toBe(422);
    expect(mocks.db.$transaction).not.toHaveBeenCalled();
  });
  it('reports the actual invalid configuration field without saving', async () => {
    const response = await PUT(req('config', 'PUT', { revision: 4, settings: { ...settings(), timeoutHours: 1 } }));
    expect(response.status).toBe(422);
    expect((await response.json()).error.message).toContain('Timeout duration');
    expect(mocks.db.discordIntegration.upsert).not.toHaveBeenCalled();
  });
  it('allows a heartbeat without replacing previously reported inventory', async () => {
    expect((await POST(req('heartbeat', 'POST', { guildId, appliedRevision: 4, botVersion: '1.0', health: 'healthy' }, 'Bearer live'))).status).toBe(200);
    expect(mocks.db.discordIntegration.update.mock.lastCall![0].data).not.toHaveProperty('metadata');
  });
});

it('requires a staff destination when enabling honeypot moderation', () => {
  expect(parseSettings({ ...settings(), honeypotEnabled: true, honeypotChannelId: guildId, membershipRoleIds: [roleId] }).error).toContain('staff log');
});
it('creates the first configuration from revision zero without losing default retention', async () => {
  mocks.db.discordIntegration.findUnique.mockResolvedValue(null);
  expect((await PUT(req('config', 'PUT', { revision: 0, settings: settings() }))).status).toBe(200);
  expect(mocks.db.discordIntegration.upsert.mock.lastCall![0].create).toMatchObject({ id: 1, revision: 1, settings: { retention: { mode: 'days', days: 7 } } });
});


describe('configuration snapshots and diagnostics', () => {
  const diagnostics = () => ({ configRevision: 4, supportedSchemaVersions: [1], pendingCount: 2, failedCount: 1, issues: [{ code: 'role_hierarchy', severity: 'error', field: 'defaultRoleIds', resourceId: roleId }], permissions: [{ capability: 'manage_roles', granted: false }] });
  const heartbeat = (extra: object = {}) => req('heartbeat', 'POST', { guildId, appliedRevision: 4, botVersion: '1.0', health: 'degraded', ...extra }, 'Bearer valid');
  it('records old and new configuration snapshots without copying evidence policy', async () => {
    expect((await PUT(req('config', 'PUT', { revision: 4, settings: settings() }))).status).toBe(200);
    expect(mocks.db.discordConfigurationRevision.upsert).toHaveBeenCalledWith({ where: { revision: 4 }, create: { revision: 4, settings: settings() }, update: {} });
    expect(mocks.db.discordConfigurationRevision.create).toHaveBeenCalledWith({ data: { revision: 5, settings: settings() } });
  });
  it('stores structured diagnostics and inventory observation time independently of heartbeat time', async () => {
    const metadataObservedAt = new Date(Date.now() - 10000).toISOString();
    expect((await POST(heartbeat({ diagnostics: diagnostics(), metadata: { roles: [], channels: [] }, metadataObservedAt }))).status).toBe(200);
    expect(mocks.db.discordIntegration.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ diagnostics: diagnostics(), metadataObservedAt: new Date(metadataObservedAt), diagnosticsReportedAt: expect.any(Date) }) }));
    const report = { ...stored(), diagnostics: diagnostics(), diagnosticsReportedAt: new Date(metadataObservedAt), metadataObservedAt: new Date(metadataObservedAt), updatedAt: new Date(metadataObservedAt) };
    mocks.db.discordIntegration.findUnique.mockResolvedValue(report);
    expect((await (await GET(req())).json()).data).toMatchObject({ diagnostics: diagnostics(), metadataObservedAt, diagnosticsReportedAt: metadataObservedAt, updatedAt: metadataObservedAt });
  });
  it('rejects future, stale and unbound inventory timestamps and unknown diagnostic data', async () => {
    expect((await POST(heartbeat({ diagnostics: { ...diagnostics(), token: 'secret' } }))).status).toBe(422);
    expect((await POST(heartbeat({ diagnostics: { ...diagnostics(), configRevision: 5 } }))).status).toBe(422);
    expect((await POST(heartbeat({ metadataObservedAt: new Date().toISOString() }))).status).toBe(422);
    expect((await POST(heartbeat({ metadata: { roles: [], channels: [] }, metadataObservedAt: new Date(Date.now() + 120000).toISOString() }))).status).toBe(422);
    mocks.db.discordIntegration.findUnique.mockResolvedValue({ ...stored(), metadataObservedAt: new Date() });
    expect((await POST(heartbeat({ metadata: { roles: [], channels: [] }, metadataObservedAt: new Date(Date.now() - 10000).toISOString() }))).status).toBe(409);
  });
  it('rejects missing or unmanageable roles only when the inventory is fresh', async () => {
    const metadata = { roles: [{ id: roleId, manageable: false }], channels: [] };
    mocks.db.discordIntegration.findUnique.mockResolvedValue({ ...stored(), metadata, metadataObservedAt: new Date() });
    expect((await PUT(req('config', 'PUT', { revision: 4, settings: { ...settings(), defaultRoleIds: [otherRoleId] } }))).status).toBe(422);
    expect((await PUT(req('config', 'PUT', { revision: 4, settings: { ...settings(), defaultRoleIds: [roleId] } }))).status).toBe(422);
    mocks.db.discordIntegration.findUnique.mockResolvedValue({ ...stored(), metadata, metadataObservedAt: new Date(Date.now() - 86400000) });
    expect((await PUT(req('config', 'PUT', { revision: 4, settings: { ...settings(), defaultRoleIds: [roleId] } }))).status).toBe(200);
  });
});


it('paginates immutable behavioral history and requires configuration permission', async () => {
  mocks.db.discordConfigurationRevision.findMany.mockResolvedValue([{id: 5, revision: 5, settings: settings()}, {id: 4, revision: 4, settings: settings()}]);
  const response = await history(req('config/history?cursor=6&limit=1'));
  expect((await response.json()).meta).toEqual({nextCursor: '5', limit: 1});
  expect(mocks.db.discordConfigurationRevision.findMany).toHaveBeenCalledWith({where: {id: {lt: 6}}, orderBy: {id: 'desc'}, take: 2});
  grant('discord:view');
  expect((await history(req('config/history'))).status).toBe(403);
});
