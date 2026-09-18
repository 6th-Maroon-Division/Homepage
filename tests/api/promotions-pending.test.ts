import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => {
  const model = () => ({ findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn() });
  return { session: vi.fn(), db: { user: model(), botToken: model(), promotionProposal: model(), rank: model(), apiAuditLog: model() } };
});
vi.mock('@/lib/prisma', () => ({ prisma: mocks.db }));
vi.mock('next-auth', () => ({ getServerSession: mocks.session }));
vi.mock('@/app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
import { GET } from '@/app/api/ranks/promotions/pending/route';
import { promotionVisibility, pendingPromotionSelect } from '@/lib/api/promotions';
const req = (query = '', bot = false) => new Request(`http://localhost/api/ranks/promotions/pending${query}`, { headers: bot ? { authorization: 'Bearer bot' } : {} });
const proposal = { id: 8, userId: 5, currentRankId: 2, nextRankId: 3, attendanceTotalAtProposal: 10, attendanceDeltaSinceLastRank: 4, status: 'pending', createdAt: new Date('2026-09-17T00:00:00Z'), user: { id: 5, username: 'Member', accounts: [{ providerUserId: '123456789012345678' }] } };
const ranks = [{ id: 2, name: 'Private', abbreviation: 'Pvt' }, { id: 3, name: 'Corporal', abbreviation: 'Cpl' }];
beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ user: { id: 4 } });
  mocks.db.user.findUnique.mockResolvedValue({ userPermissions: [{ permission: { key: 'rank:manage_promotions' }, value: 2 }] });
  mocks.db.botToken.findFirst.mockResolvedValue({ id: 9 });
  mocks.db.promotionProposal.findMany.mockResolvedValue([proposal]);
  mocks.db.rank.findMany.mockResolvedValue(ranks);
});
describe('pending promotion auth and visibility', () => {
  it('requires live management permission and authenticated credentials', async () => {
    expect((await GET(req())).status).toBe(200);
    mocks.db.user.findUnique.mockResolvedValue({ userPermissions: [] });
    expect((await GET(req())).status).toBe(403);
    mocks.session.mockResolvedValue(null);
    expect((await GET(req())).status).toBe(401);
    expect((await GET(req('', true))).status).toBe(200);
    mocks.session.mockResolvedValue({ user: { id: 4 } });
    mocks.db.botToken.findFirst.mockResolvedValue(null);
    expect((await GET(req('', true))).status).toBe(401);
  });
  it('places the same self-or-strict-hierarchy guard in the database query before pagination', async () => {
    await GET(req('?cursor=9&limit=1'));
    const visibility = { user: { OR: [{ id: 4 }, { userPermissions: { none: { OR: [{ permission: { key: 'system:super_admin' }, value: { gt: 0 } }, { permission: { key: 'rank:manage_promotions' }, value: { gte: 2 } }] } } }] } };
    expect(promotionVisibility({ kind: 'user', userId: 4, permissions: { 'rank:manage_promotions': 2 } })).toEqual(visibility);
    expect(mocks.db.promotionProposal.findMany).toHaveBeenCalledWith({ where: { status: 'pending', ...visibility, id: { lt: 9 } }, select: pendingPromotionSelect, orderBy: { id: 'desc' }, take: 2 });
  });
  it('allows superadmins and bots all pending targets without hierarchy filters', async () => {
    mocks.db.user.findUnique.mockResolvedValue({ userPermissions: [{ permission: { key: 'system:super_admin' }, value: 1 }] });
    await GET(req());
    expect(mocks.db.promotionProposal.findMany.mock.lastCall![0].where).toEqual({ status: 'pending' });
    await GET(req('', true));
    expect(mocks.db.promotionProposal.findMany.mock.lastCall![0].where).toEqual({ status: 'pending' });
  });
});
describe('pending promotion contracts', () => {
  it.each(['?page=1', '?status=approved', '?limit=1&limit=2', '?cursor=2&cursor=3', '?limit=0', '?cursor=2147483648'])('rejects invalid or ambiguous query %s', async query => {
    expect((await GET(req(query))).status).toBe(400);
    expect(mocks.db.promotionProposal.findMany).not.toHaveBeenCalled();
  });
  it('returns minimal DTO from proposal rank IDs and only first discord account', async () => {
    const response = await GET(req());
    expect(await response.json()).toEqual({ data: [{ ...proposal, createdAt: '2026-09-17T00:00:00.000Z', user: { id: 5, username: 'Member', discordId: '123456789012345678' }, currentRank: ranks[0], nextRank: ranks[1] }], meta: { limit: 50, nextCursor: null } });
    expect(mocks.db.rank.findMany).toHaveBeenCalledWith({ where: { id: { in: [2, 3] } }, select: { id: true, name: true, abbreviation: true } });
    expect(pendingPromotionSelect.user.select.accounts).toEqual({ where: { provider: 'discord' }, orderBy: { id: 'asc' }, take: 1, select: { providerUserId: true } });
    expect(Object.keys(pendingPromotionSelect.user.select).sort()).toEqual(['accounts', 'id', 'username']);
    expect(Object.keys(pendingPromotionSelect).sort()).toEqual(['id', 'userId', 'currentRankId', 'nextRankId', 'attendanceTotalAtProposal', 'attendanceDeltaSinceLastRank', 'status', 'createdAt', 'user'].sort());
  });
  it('handles removed rank IDs and absent Discord linkage as null', async () => {
    mocks.db.promotionProposal.findMany.mockResolvedValue([{ ...proposal, user: { id: 5, username: null, accounts: [] } }]);
    mocks.db.rank.findMany.mockResolvedValue([]);
    expect((await (await GET(req())).json()).data[0]).toMatchObject({ user: { username: null, discordId: null }, currentRank: null, nextRank: null });
  });
  it('uses real lookahead and fetches rank metadata for the returned page only', async () => {
    mocks.db.promotionProposal.findMany.mockResolvedValue([proposal, { ...proposal, id: 7, currentRankId: 99, nextRankId: 100 }]);
    expect((await (await GET(req('?limit=1'))).json()).meta).toEqual({ limit: 1, nextCursor: '8' });
    expect(mocks.db.rank.findMany.mock.lastCall![0].where.id.in).toEqual([2, 3]);
    mocks.db.promotionProposal.findMany.mockResolvedValue([proposal]);
    expect((await (await GET(req('?limit=1'))).json()).meta.nextCursor).toBeNull();
    mocks.db.promotionProposal.findMany.mockResolvedValue([]);
    expect(await (await GET(req('?limit=200'))).json()).toEqual({ data: [], meta: { limit: 100, nextCursor: null } });
    expect(mocks.db.promotionProposal.findMany.mock.lastCall![0].take).toBe(101);
  });
});
describe('pending promotion read privacy', () => {
  it('audits unique returned other users excluding self and lookahead', async () => {
    mocks.db.promotionProposal.findMany.mockResolvedValue([{ ...proposal, userId: 4, user: { ...proposal.user, id: 4 } }, proposal, { ...proposal, id: 7 }, { ...proposal, id: 6, userId: 99 }]);
    const response = await GET(req('?limit=3'));
    const audit = mocks.db.apiAuditLog.create.mock.lastCall![0].data;
    expect(audit).toMatchObject({ action: 'user_data.read', resource: 'promotion_proposal', actorUserId: 4, targetUserIds: [5], correlationId: response.headers.get('X-Request-Id') });
    expect(audit).not.toHaveProperty('before'); expect(audit).not.toHaveProperty('after');
    expect(JSON.stringify(audit)).not.toContain('Member');
    expect(JSON.stringify(audit)).not.toContain('123456789012345678');
  });
  it('does not audit empty or self-only pages', async () => {
    mocks.db.promotionProposal.findMany.mockResolvedValue([{ ...proposal, userId: 4, user: { ...proposal.user, id: 4 } }, proposal]);
    await GET(req('?limit=1'));
    expect(mocks.db.apiAuditLog.create).not.toHaveBeenCalled();
    mocks.db.promotionProposal.findMany.mockResolvedValue([]);
    await GET(req('', true));
    expect(mocks.db.apiAuditLog.create).not.toHaveBeenCalled();
  });
  it('audits all returned user targets for a bot', async () => {
    await GET(req('', true));
    expect(mocks.db.apiAuditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ actorType: 'bot', actorTokenId: 9, targetUserIds: [5] }) });
  });
  it('withholds private response if required audit persistence fails', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.db.apiAuditLog.create.mockRejectedValue(new Error('Audit unavailable'));
    const response = await GET(req());
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).not.toHaveProperty('data');
    expect(JSON.stringify(body)).not.toContain('Member');
    log.mockRestore();
  });
});
