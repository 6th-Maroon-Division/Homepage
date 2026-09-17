import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => {
  const model = () => ({ findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn(), upsert: vi.fn(), create: vi.fn(), count: vi.fn() });
  return { session: vi.fn(), db: { user: model(), botToken: model(), rank: model(), training: model(), rankTransitionRequirement: model(), apiAuditLog: model(), $transaction: vi.fn() } };
});
vi.mock('@/lib/prisma', () => ({ prisma: mocks.db }));
vi.mock('next-auth', () => ({ getServerSession: mocks.session }));
vi.mock('@/app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
import { GET, PATCH } from '@/app/api/ranks/[id]/requirements/route';
import { parseRankRequirements } from '@/lib/api/rank-requirements';
const ctx = (id = '1') => ({ params: Promise.resolve({ id }) });
const req = (method = 'GET', body?: unknown, bot = false) => new Request('http://localhost/api/ranks/1/requirements', { method, headers: bot ? { authorization: 'Bearer bot' } : {}, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const required = { id: 2, name: 'Basic', category: { name: 'Core' } };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ user: { id: 4 } });
  mocks.db.user.findUnique.mockResolvedValue({ userPermissions: [{ permission: { key: 'rank:edit' }, value: 1 }] });
  mocks.db.botToken.findFirst.mockResolvedValue({ id: 9 });
  mocks.db.rank.findUnique.mockResolvedValue({ id: 1 });
  mocks.db.training.count.mockImplementation(async ({ where }) => where.id.in.length);
  mocks.db.rankTransitionRequirement.findUnique.mockResolvedValue({ requiredTrainings: [required] });
  mocks.db.rankTransitionRequirement.upsert.mockImplementation(async ({ update }) => ({ requiredTrainings: update.requiredTrainings.set.map(({ id }: { id: number }) => ({ ...required, id })) }));
  mocks.db.$transaction.mockImplementation(async cb => cb(mocks.db));
});
describe('rank requirement authorization', () => {
  it.each([GET, PATCH])('requires valid user/bot credentials and rank edit rights', async handler => {
    const method = handler === PATCH ? 'PATCH' : 'GET';
    const body = handler === PATCH ? { requiredTrainingIds: [] } : undefined;
    expect((await handler(req(method, body), ctx())).status).toBe(200);
    expect((await handler(req(method, body, true), ctx())).status).toBe(200);
    mocks.db.user.findUnique.mockResolvedValue({ userPermissions: [] });
    expect((await handler(req(method, body), ctx())).status).toBe(403);
    mocks.session.mockResolvedValue(null);
    expect((await handler(req(method, body), ctx())).status).toBe(401);
    mocks.session.mockResolvedValue({ user: { id: 4 } });
    mocks.db.botToken.findFirst.mockResolvedValue(null);
    expect((await handler(req(method, body, true), ctx())).status).toBe(401);
  });
});
describe('rank requirements contract', () => {
  it.each([null, [], {}, { trainingId: 2 }, { requiredTrainingIds: [], extra: true }, { requiredTrainingIds: null }, { requiredTrainingIds: ['2'] }, { requiredTrainingIds: [0] }, { requiredTrainingIds: [2147483648] }, { requiredTrainingIds: [2, 2] }])('rejects invalid body %j', async body => expect((await PATCH(req('PATCH', body), ctx())).status).toBe(422));
  it('sorts numeric IDs and accepts empty replacement', () => {
    expect(parseRankRequirements({ requiredTrainingIds: [3, 2] })).toEqual({ data: [2, 3] });
    expect(parseRankRequirements({ requiredTrainingIds: [] })).toEqual({ data: [] });
  });
  it.each([GET, PATCH])('rejects invalid target IDs and missing ranks', async handler => {
    const method = handler === PATCH ? 'PATCH' : 'GET';
    const body = handler === PATCH ? { requiredTrainingIds: [] } : undefined;
    for (const id of ['bad', '0', '2147483648']) expect((await handler(req(method, body), ctx(id))).status).toBe(400);
    mocks.db.rank.findUnique.mockResolvedValue(null);
    expect((await handler(req(method, body), ctx())).status).toBe(404);
  });
  it('rejects malformed JSON', async () => expect((await PATCH(new Request('http://localhost/api', { method: 'PATCH', body: '{' }), ctx())).status).toBe(400));
  it('returns enriched data and empty defaults without creating rows or read audits', async () => {
    expect(await (await GET(req(), ctx())).json()).toEqual({ data: { requiredTrainingIds: [2], requiredTrainings: [required] }, meta: {} });
    expect(mocks.db.rankTransitionRequirement.findUnique).toHaveBeenCalledWith(expect.objectContaining({ select: { requiredTrainings: { orderBy: { id: 'asc' }, select: { id: true, name: true, category: { select: { name: true } } } } } }));
    mocks.db.rankTransitionRequirement.findUnique.mockResolvedValue(null);
    expect(await (await GET(req(), ctx())).json()).toEqual({ data: { requiredTrainingIds: [], requiredTrainings: [] }, meta: {} });
    expect(mocks.db.rankTransitionRequirement.upsert).not.toHaveBeenCalled();
    expect(mocks.db.apiAuditLog.create).not.toHaveBeenCalled();
  });
});
describe('atomic rank requirement replacement', () => {
  it('validates missing trainings before any mutation', async () => {
    mocks.db.training.count.mockResolvedValue(0);
    expect((await PATCH(req('PATCH', { requiredTrainingIds: [2] }), ctx())).status).toBe(404);
    expect(mocks.db.rankTransitionRequirement.upsert).not.toHaveBeenCalled();
  });
  it('replaces existing links with sorted IDs and audits before/after in Serializable transaction', async () => {
    const response = await PATCH(req('PATCH', { requiredTrainingIds: [4, 3] }), ctx());
    expect(await response.json()).toMatchObject({ data: { requiredTrainingIds: [3, 4] } });
    expect(mocks.db.rankTransitionRequirement.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { targetRankId: 1 }, create: { targetRankId: 1, requiredTrainings: { connect: [{ id: 3 }, { id: 4 }] } }, update: { requiredTrainings: { set: [{ id: 3 }, { id: 4 }] } } }));
    expect(mocks.db.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'Serializable' });
    expect(mocks.db.apiAuditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'rank_requirements.updated', resource: 'rank_requirements', resourceId: '1', actorUserId: 4, before: { requiredTrainingIds: [2] }, after: { requiredTrainingIds: [3, 4] } }) });
  });
  it('creates an absent requirement and lets a bot clear it', async () => {
    mocks.db.rankTransitionRequirement.findUnique.mockResolvedValue(null);
    expect((await PATCH(req('PATCH', { requiredTrainingIds: [2] }), ctx())).status).toBe(200);
    expect(mocks.db.apiAuditLog.create.mock.lastCall![0].data.before).toEqual({ requiredTrainingIds: [] });
    expect(await (await PATCH(req('PATCH', { requiredTrainingIds: [] }, true), ctx())).json()).toEqual({ data: { requiredTrainingIds: [], requiredTrainings: [] }, meta: {} });
    expect(mocks.db.apiAuditLog.create.mock.lastCall![0].data).toMatchObject({ actorType: 'bot', actorTokenId: 9, after: { requiredTrainingIds: [] } });
  });
  it.each([['P2002', 409], ['P2003', 409], ['P2034', 409], ['P2025', 404]])('maps database failure %s', async (code, status) => {
    mocks.db.$transaction.mockRejectedValue({ code });
    const response = await PATCH(req('PATCH', { requiredTrainingIds: [] }), ctx());
    expect(response.status).toBe(status);
    if (status === 409) expect((await response.json()).error.message).toContain('retry');
  });
  it('fails closed if audit persistence fails', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.db.apiAuditLog.create.mockRejectedValue(new Error('Audit unavailable'));
    expect((await PATCH(req('PATCH', { requiredTrainingIds: [] }), ctx())).status).toBe(500);
    spy.mockRestore();
  });
});
