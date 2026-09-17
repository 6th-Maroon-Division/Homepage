import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ session: vi.fn(), db: { user: { findUnique: vi.fn(), findMany: vi.fn() }, botToken: { findFirst: vi.fn(), update: vi.fn() }, apiAuditLog: { create: vi.fn() } } }));
vi.mock('@/lib/prisma', () => ({ prisma: mocks.db }));
vi.mock('next-auth', () => ({ getServerSession: mocks.session }));
vi.mock('@/app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
import { GET } from '@/app/api/training-users/route';
import { TRAINING_STAFF_PERMISSION_KEYS } from '@/lib/training-staff';
const req = (query = '', bot = false) => new Request(`http://localhost/api/training-users${query}`, { headers: bot ? { authorization: 'Bearer bot' } : {} });
const self = { id: 4, username: 'Trainer', avatarUrl: null, userPermissions: [{ id: 7 }] };
const member = { id: 5, username: 'Member', avatarUrl: '/avatar.png', userPermissions: [] };
const qualifyingGrant = { value: { gt: 0 }, permission: { key: { in: [...TRAINING_STAFF_PERMISSION_KEYS] } } };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ user: { id: 4 } });
  mocks.db.user.findUnique.mockResolvedValue({ userPermissions: [{ permission: { key: 'training:mark' }, value: 1 }] });
  mocks.db.user.findMany.mockResolvedValue([self, member]);
  mocks.db.botToken.findFirst.mockResolvedValue({ id: 9 });
});
describe('training-user lookup authentication', () => {
  it.each(TRAINING_STAFF_PERMISSION_KEYS)('accepts positive %s grants from live database', async permission => {
    mocks.db.user.findUnique.mockResolvedValue({ userPermissions: [{ permission: { key: permission }, value: 1 }] });
    expect((await GET(req())).status).toBe(200);
  });
  it('rejects unprivileged or zero-level grants, auditing denied access', async () => {
    mocks.db.user.findUnique.mockResolvedValue({ userPermissions: [] });
    expect((await GET(req())).status).toBe(403);
    mocks.db.user.findUnique.mockResolvedValue({ userPermissions: [{ permission: { key: 'training:mark' }, value: 0 }] });
    expect((await GET(req())).status).toBe(403);
    expect(mocks.db.user.findMany).not.toHaveBeenCalled();
    expect(mocks.db.apiAuditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'access.denied', actorUserId: 4 }) });
  });
  it('accepts active bots and rejects absent/invalid/revoked credentials without fallback', async () => {
    expect((await GET(req('', true))).status).toBe(200);
    mocks.session.mockResolvedValue(null);
    expect((await GET(req())).status).toBe(401);
    mocks.session.mockResolvedValue({ user: { id: 4 } });
    mocks.db.botToken.findFirst.mockResolvedValue(null);
    expect((await GET(req('', true))).status).toBe(401);
    expect(mocks.db.botToken.findFirst).toHaveBeenLastCalledWith(expect.objectContaining({ where: { token: 'bot', isActive: true } }));
  });
});
describe('training-user query and DTO', () => {
  it.each(['?staffOnly=1', '?staffOnly=', '?limit=0', '?cursor=bad', '?cursor=2147483648'])('rejects invalid filters %s', async query => {
    expect((await GET(req(query))).status).toBe(400);
    expect(mocks.db.user.findMany).not.toHaveBeenCalled();
  });
  it('returns only public DTO fields and computes staff flags from filtered positive grants', async () => {
    const response = await GET(req());
    expect(await response.json()).toEqual({ data: [{ id: 4, username: 'Trainer', avatarUrl: null, isTrainer: true }, { id: 5, username: 'Member', avatarUrl: '/avatar.png', isTrainer: false }], meta: { limit: 50, nextCursor: null } });
    expect(mocks.db.user.findMany).toHaveBeenCalledTimes(1);
    expect(mocks.db.user.findMany).toHaveBeenCalledWith({ where: {}, select: { id: true, username: true, avatarUrl: true, userPermissions: { where: qualifyingGrant, select: { id: true } } }, orderBy: { id: 'asc' }, take: 51 });
  });
  it('filters qualifying staff in the database before pagination', async () => {
    mocks.db.user.findMany.mockResolvedValue([self]);
    expect((await GET(req('?staffOnly=true&limit=1&cursor=3'))).status).toBe(200);
    expect(mocks.db.user.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: { userPermissions: { some: qualifyingGrant }, id: { gt: 3 } }, take: 2 }));
    await GET(req('?staffOnly=false'));
    expect(mocks.db.user.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: {} }));
  });
  it('uses actual lookahead and caps limits', async () => {
    const page = await GET(req('?limit=1'));
    expect(await page.json()).toMatchObject({ data: [{ id: 4 }], meta: { limit: 1, nextCursor: '4' } });
    mocks.db.user.findMany.mockResolvedValue([self]);
    expect((await (await GET(req('?limit=1'))).json()).meta.nextCursor).toBeNull();
    await GET(req('?limit=999'));
    expect(mocks.db.user.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ take: 101 }));
  });
});
describe('training-user privacy audits', () => {
  it('audits returned other users excluding self and lookahead', async () => {
    mocks.db.user.findMany.mockResolvedValue([self, member, { ...member, id: 6 }]);
    const response = await GET(req('?limit=2'));
    const data = mocks.db.apiAuditLog.create.mock.lastCall![0].data;
    expect(data).toMatchObject({ action: 'user_data.read', resource: 'training_user', actorUserId: 4, targetUserIds: [5], correlationId: response.headers.get('X-Request-Id') });
    expect(data).not.toHaveProperty('before');
    expect(data).not.toHaveProperty('after');
    expect(JSON.stringify(data)).not.toContain('Member');
    expect(JSON.stringify(data)).not.toContain('avatar.png');
  });
  it('does not log self-only or empty reads, including excluded lookahead', async () => {
    await GET(req('?limit=1'));
    expect(mocks.db.apiAuditLog.create).not.toHaveBeenCalled();
    mocks.db.user.findMany.mockResolvedValue([]);
    expect(await (await GET(req('', true))).json()).toEqual({ data: [], meta: { limit: 50, nextCursor: null } });
    expect(mocks.db.apiAuditLog.create).not.toHaveBeenCalled();
  });
  it('attributes bot reads to the token and includes all returned user IDs', async () => {
    await GET(req('', true));
    expect(mocks.db.apiAuditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ actorType: 'bot', actorTokenId: 9, targetUserIds: [4, 5] }) });
  });
  it('fails closed without returning personal information when auditing fails', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.db.apiAuditLog.create.mockRejectedValue(new Error('Audit unavailable'));
    const response = await GET(req());
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).not.toHaveProperty('data');
    expect(JSON.stringify(body)).not.toContain('Member');
    spy.mockRestore();
  });
});
