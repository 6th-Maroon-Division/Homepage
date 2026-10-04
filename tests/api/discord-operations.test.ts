import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PermissionKey } from '@/lib/permissions';
const mocks = vi.hoisted(() => {
  const model = () => ({ findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn() });
  return { session: vi.fn(), audit: vi.fn(), db: { $transaction: vi.fn(), user: model(), botToken: model(), discordIntegration: model(), discordOperation: model() } };
});
vi.mock('@/lib/prisma', () => ({ prisma: mocks.db }));
vi.mock('next-auth', () => ({ getServerSession: mocks.session }));
vi.mock('@/app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
vi.mock('@/lib/api/audit', () => ({ writeApiAudit: mocks.audit }));
import { GET, POST } from '@/app/api/discord/operations/route';
const guildId = '111111111111111111';
const report = () => ({ eventId: 'join:member:2026-10-04:roles', guildId, configRevision: 4, kind: 'join.roles', status: 'failed', attempts: 3, errorCode: 'missing_permissions', occurredAt: '2026-01-01T10:00:00Z' });
const req = (method = 'GET', payload?: unknown, token?: string, query = '') => new Request(`http://localhost/api/discord/operations${query}`, { method, headers: token ? { authorization: `Bearer ${token}` } : {}, ...(payload === undefined ? {} : { body: JSON.stringify(payload) }) });
function grant(...keys: PermissionKey[]) {
  mocks.session.mockResolvedValue({ user: { id: 8 } });
  mocks.db.user.findUnique.mockResolvedValue({ userPermissions: keys.map(key => ({ value: 1, permission: { key } })) });
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue(null);
  mocks.db.botToken.findFirst.mockResolvedValue({ id: 7 });
  mocks.db.discordIntegration.findUnique.mockResolvedValue({ revision: 5, settings: { settings: { guildId } } });
  mocks.db.discordOperation.findUnique.mockResolvedValue(null);
  mocks.db.discordOperation.findMany.mockResolvedValue([]);
  mocks.db.discordOperation.create.mockImplementation(({ data }) => ({ id: 1, ...data, createdAt: new Date() }));
  mocks.db.$transaction.mockImplementation(fn => fn(mocks.db));
});
describe('Discord automatic operation reports', () => {
  it('requires authentication and bot credentials for writes, including superadmins', async () => {
    expect((await POST(req('POST', report()))).status).toBe(401);
    grant('system:super_admin');
    expect((await POST(req('POST', report()))).status).toBe(403);
    expect(mocks.db.discordOperation.create).not.toHaveBeenCalled();
  });
  it('rejects revoked tokens without falling back to a session', async () => {
    grant('system:super_admin'); mocks.db.botToken.findFirst.mockResolvedValue(null);
    expect((await POST(req('POST', report(), 'revoked'))).status).toBe(401);
    expect(mocks.session).not.toHaveBeenCalled();
  });
  it('records and audits delayed failures against a known older configuration', async () => {
    const response = await POST(req('POST', report(), 'live'));
    expect(response.status).toBe(201);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect((await response.json()).data).toMatchObject({ id: 1, errorCode: 'missing_permissions', configRevision: 4 });
    expect(mocks.audit).toHaveBeenCalledWith(mocks.db, expect.anything(), expect.objectContaining({ action: 'discord.operation.reported' }));
  });
  it('accepts successes and bounded resource identifiers', async () => {
    expect((await POST(req('POST', { ...report(), kind: 'menu.roles', attempts: 6, status: 'succeeded', errorCode: undefined, memberId: guildId, channelId: guildId, roleId: guildId, menuId: 'games' }, 'live'))).status).toBe(201);
  });
  it('replays immutably even after config changes, without adding another audit', async () => {
    await POST(req('POST', report(), 'live'));
    const existing = mocks.db.discordOperation.create.mock.results[0].value;
    mocks.db.discordOperation.findUnique.mockResolvedValue(existing);
    mocks.db.discordIntegration.findUnique.mockClear(); mocks.audit.mockClear();
    expect((await POST(req('POST', { ...report(), occurredAt: '2026-01-01T11:00:00+01:00' }, 'live'))).status).toBe(200);
    expect(mocks.db.discordOperation.create).toHaveBeenCalledTimes(1);
    expect(mocks.db.discordIntegration.findUnique).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
    expect((await POST(req('POST', { ...report(), attempts: 2 }, 'live'))).status).toBe(409);
    expect((await POST(req('POST', { ...report(), occurredAt: '2026-01-02T10:00:00Z' }, 'live'))).status).toBe(409);
  });
  it.each([
    { eventId: '' }, { eventId: 'a'.repeat(129) }, { guildId: 'abc' }, { configRevision: 0 }, { kind: 'freeform' }, { status: 'pending' }, { attempts: 4 },
    { memberId: null }, { channelId: 'bad' }, { roleId: 'bad' }, { menuId: {} }, { errorCode: 'secret raw message' }, { errorCode: undefined },
    { status: 'succeeded' }, { occurredAt: 'not a date' }, { occurredAt: '9999-01-01T00:00:00Z' }, { content: 'private message' },
  ])('rejects invalid or unbounded payload %j', async patch => {
    expect((await POST(req('POST', { ...report(), ...patch }, 'live'))).status).toBe(422);
    expect(mocks.db.discordOperation.create).not.toHaveBeenCalled();
  });
  it('rejects unknown/future configurations and another server', async () => {
    expect((await POST(req('POST', { ...report(), configRevision: 6 }, 'live'))).status).toBe(409);
    expect((await POST(req('POST', { ...report(), guildId: '222222222222222222' }, 'live'))).status).toBe(409);
    mocks.db.discordIntegration.findUnique.mockResolvedValue(null);
    expect((await POST(req('POST', report(), 'live'))).status).toBe(409);
  });
  it('rejects oversized payloads and unknown query parameters', async () => {
    expect((await POST(req('POST', { ...report(), eventId: 'a'.repeat(4096) }, 'live'))).status).toBe(413);
    expect((await POST(req('POST', report(), 'live', '?extra=1'))).status).toBe(400);
  });
  it('maps concurrent duplicate or serialization races to a retryable conflict', async () => {
    mocks.db.$transaction.mockRejectedValue({ code: 'P2002' });
    expect((await POST(req('POST', report(), 'live'))).status).toBe(409);
  });
});
describe('Discord operations review', () => {
  it('restricts reads to view/configure or superadmin', async () => {
    expect((await GET(req())).status).toBe(401);
    grant('discord:evidence_view'); expect((await GET(req())).status).toBe(403);
    expect(mocks.db.discordOperation.findMany).not.toHaveBeenCalled();
    for (const key of ['discord:view', 'discord:configure', 'system:super_admin'] as PermissionKey[]) { grant(key); expect((await GET(req())).status).toBe(200); }
  });
  it('paginates by descending ID and filters reports with a read audit', async () => {
    grant('discord:view'); mocks.db.discordOperation.findMany.mockResolvedValue([{ id: 9 }, { id: 8 }]);
    const response = await GET(req('GET', undefined, undefined, '?cursor=10&limit=1&kind=join.roles&status=failed'));
    expect((await response.json())).toMatchObject({ data: [{ id: 9 }], meta: { nextCursor: '9', limit: 1 } });
    expect(mocks.db.discordOperation.findMany).toHaveBeenCalledWith({ where: { id: { lt: 10 }, kind: 'join.roles', status: 'failed' }, orderBy: { id: 'desc' }, take: 2 });
    expect(mocks.audit).toHaveBeenCalledWith(mocks.db, expect.anything(), expect.objectContaining({ action: 'discord.operations.read' }));
  });
  it.each(['?kind=unknown', '?status=unknown', '?kind=', '?status=', '?limit=bad', '?other=true'])('rejects invalid filters %s', async query => {
    grant('discord:view'); expect((await GET(req('GET', undefined, undefined, query))).status).toBe(400);
  });
});
