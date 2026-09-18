import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => {
  const model = () => ({ findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn(), create: vi.fn(), createMany: vi.fn(), deleteMany: vi.fn() });
  return { session: vi.fn(), publish: vi.fn(), catalog: vi.fn(), db: { user: model(), botToken: model(), orbat: model(), squad: model(), slot: model(), squadRole: model(), radioFrequency: model(), orbatRadioFrequency: model(), botEvent: model(), apiAuditLog: model(), $transaction: vi.fn() } };
});
vi.mock('@/lib/prisma', () => ({ prisma: mocks.db }));
vi.mock('next-auth', () => ({ getServerSession: mocks.session }));
vi.mock('@/app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
vi.mock('@/lib/realtime/orbat-events', () => ({ publishOrbatEvent: mocks.publish }));
vi.mock('@/lib/realtime/admin-catalog-events', () => ({ publishAdminCatalogEvent: mocks.catalog }));
import { POST } from '@/app/api/orbats/route';
const payload = () => ({ name: ' Operation ', squads: [{ name: ' Alpha ', orderIndex: 0, slots: [{ orderIndex: 0, maxSignups: 9999, squadRoleId: 7 }] }] });
const req = (body: unknown = payload(), authorization?: string, query = '') => new Request(`http://localhost/api/orbats${query}`, { method: 'POST', headers: authorization ? { authorization } : {}, body: JSON.stringify(body) });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ user: { id: 4 } });
  mocks.db.user.findUnique.mockResolvedValue({ userPermissions: [{ permission: { key: 'orbat:create' }, value: 1 }] });
  mocks.db.botToken.findFirst.mockResolvedValue({ id: 9 });
  mocks.db.squadRole.findMany.mockResolvedValue([{ id: 7, isRetired: false }]);
  mocks.db.radioFrequency.findMany.mockResolvedValue([{ id: 8 }]);
  mocks.db.orbat.create.mockImplementation(async ({ data }) => ({ ...data, id: 20, createdAt: new Date('2030-01-01T00:00:00Z') }));
  mocks.db.squad.create.mockResolvedValue({ id: 21 });
  mocks.db.slot.create.mockResolvedValue({ id: 22 });
  mocks.db.$transaction.mockImplementation(async cb => cb(mocks.db));
});
describe('operation creation access and contracts', () => {
  it('creates for live authorized users and bots with truthful creator attribution', async () => {
    expect(await (await POST(req())).json()).toEqual({ data: { id: 20 }, meta: {} });
    expect(mocks.db.orbat.create.mock.lastCall![0].data.createdById).toBe(4);
    expect((await POST(req(payload(), 'Bearer valid'))).status).toBe(201);
    expect(mocks.db.orbat.create.mock.lastCall![0].data.createdById).toBeNull();
    expect(mocks.db.apiAuditLog.create.mock.lastCall![0].data).toMatchObject({ actorType: 'bot', actorUserId: null, actorTokenId: 9, action: 'orbat.created', resource: 'orbat', resourceId: '20' });
    expect(mocks.publish.mock.lastCall![0].actorUserId).toBeNull();
    expect(mocks.db.$transaction.mock.lastCall![1]).toEqual({ isolationLevel: 'Serializable' });
  });
  it('rejects absent, stale, revoked and malformed credentials and revoked grants', async () => {
    mocks.session.mockResolvedValue(null);
    expect((await POST(req())).status).toBe(401);
    mocks.session.mockResolvedValue({ user: { id: 4 } });
    mocks.db.user.findUnique.mockResolvedValue(null);
    expect((await POST(req())).status).toBe(401);
    mocks.db.user.findUnique.mockResolvedValue({ userPermissions: [] });
    expect((await POST(req())).status).toBe(403);
    mocks.db.botToken.findFirst.mockResolvedValue(null);
    expect((await POST(req(payload(), 'Bearer revoked'))).status).toBe(401);
    expect((await POST(req(payload(), 'Basic invalid'))).status).toBe(401);
    expect(mocks.db.orbat.create).not.toHaveBeenCalled();
  });
  it('rejects query arguments and malformed JSON with correlated errors', async () => {
    const response = await POST(req(payload(), undefined, '?legacy=1'));
    expect(response.status).toBe(400);
    expect((await response.json()).error.correlationId).toBe(response.headers.get('X-Request-Id'));
    expect((await POST(new Request('http://localhost/api/orbats', { method: 'POST', body: '{' }))).status).toBe(400);
    expect(mocks.db.$transaction).not.toHaveBeenCalled();
  });
  it.each([
    null, [], {}, { ...payload(), name: ' ' }, { ...payload(), eventDate: '2030-01-01' }, { ...payload(), description: 5 },
    { ...payload(), startsAtUtc: '2030-01-01T12:00:00' }, { ...payload(), startsAtUtc: '2000-01-01T00:00:00Z' },
    { ...payload(), eventDateUtc: '2000-01-01T00:00:00Z' }, { ...payload(), endsAtUtc: '2030-01-01T12:00:00Z' },
    { ...payload(), startsAtUtc: '2030-01-01T12:00:00Z', endsAtUtc: '2030-01-01T12:00:00Z' },
    { ...payload(), isSideOp: 'true' }, { ...payload(), squads: [] }, { ...payload(), squads: [null] },
    { ...payload(), squads: [payload().squads[0], payload().squads[0]] },
    ...[{ orderIndex: 0, maxSignups: 0 }, { orderIndex: 0, maxSignups: null }, { orderIndex: 0, maxSignups: 1, name: 'legacy' }, { orderIndex: -1, maxSignups: 1 }, { orderIndex: 0, maxSignups: 1, squadRoleId: 2147483648 }].map(slot => ({ ...payload(), squads: [{ name: 'A', orderIndex: 0, slots: [slot] }] })),
    { ...payload(), squads: [{ name: 'A', orderIndex: 0, slots: [payload().squads[0].slots[0], payload().squads[0].slots[0]] }] },
    { ...payload(), squads: [{ name: 'A', orderIndex: 0, slots: [] }] },
    { ...payload(), frequencyIds: [1, 1] }, { ...payload(), frequencyIds: ['1'] }, { ...payload(), frequencyIds: null },
    { ...payload(), tempFrequencies: null }, { ...payload(), tempFrequencies: [null] },
    { ...payload(), tempFrequencies: [{ frequency: '31', type: 'FM', isAdditional: false, channel: '', callsign: '' }] },
  ])('rejects invalid or legacy payload %# without mutations', async body => {
    expect((await POST(req(body))).status).toBe(422);
    expect(mocks.db.$transaction).not.toHaveBeenCalled();
  });
});
describe('operation creation persistence', () => {
  it('normalizes dates and text, persists references and keeps free text out of audit', async () => {
    const response = await POST(req({ ...payload(), description: ' Private briefing ', startsAtUtc: '2030-01-01T12:00:00+02:00', endsAtUtc: '2030-01-01T14:00:00+02:00', eventDateUtc: '1990-01-01T00:00:00Z', timezone: ' UTC ', frequencyIds: [8], tempFrequencies: [{ frequency: ' 31 ', type: 'SR', isAdditional: false, channel: ' 1 ', callsign: ' Alpha ' }], isSideOp: true }));
    expect(response.status).toBe(201);
    expect(mocks.db.orbat.create.mock.lastCall![0].data).toMatchObject({ name: 'Operation', description: 'Private briefing', startTime: '10:00', endTime: '12:00', eventDate: new Date('2030-01-01T10:00:00Z'), startsAtUtc: new Date('2030-01-01T10:00:00Z'), tempFrequencies: [{ frequency: '31', type: 'SR', isAdditional: false, channel: '1', callsign: 'Alpha' }] });
    expect(mocks.db.squad.create).toHaveBeenCalledWith({ data: { orbatId: 20, name: 'Alpha', orderIndex: 0 } });
    expect(mocks.db.slot.create).toHaveBeenCalledWith({ data: { orbatId: 20, squadId: 21, orderIndex: 0, maxSignups: 9999, squadRoleId: 7 } });
    expect(mocks.db.orbatRadioFrequency.createMany).toHaveBeenCalledWith({ data: [{ orbatId: 20, radioFrequencyId: 8 }] });
    expect(mocks.db.botEvent.create.mock.lastCall![0].data).toMatchObject({ type: 'orbat.created', aggregate: 'orbat', aggregateId: '20', payload: { orbatId: 20, version: '2030-01-01T00:00:00.000Z', name: 'Operation' } });
    const audit = mocks.db.apiAuditLog.create.mock.lastCall![0].data;
    expect(audit.after).toMatchObject({ squads: [{ id: 21, slotIds: [22] }], roleIds: [7], frequencyIds: [8], startsAtUtc: '2030-01-01T10:00:00.000Z' });
    expect(JSON.stringify(audit)).not.toContain('Private briefing');
    expect(audit.targetUserIds).toEqual([]);
  });
  it('supports unspecified timing/roles and date-only canonical fallback', async () => {
    const body = { ...payload(), description: ' ', squads: [{ name: 'A', orderIndex: 0, slots: [{ orderIndex: 0, maxSignups: 1 }] }] };
    expect((await POST(req(body))).status).toBe(201);
    expect(mocks.db.orbat.create.mock.lastCall![0].data).toMatchObject({ startsAtUtc: null, endsAtUtc: null, eventDate: null, description: null });
    expect(mocks.db.squadRole.findMany).not.toHaveBeenCalled();
    expect(mocks.db.radioFrequency.findMany).not.toHaveBeenCalled();
    expect(mocks.db.slot.create.mock.lastCall![0].data.squadRoleId).toBeNull();
    expect((await POST(req({ ...body, eventDateUtc: '2030-01-02T00:00:00Z' }))).status).toBe(201);
    expect(mocks.db.orbat.create.mock.lastCall![0].data.eventDate).toEqual(new Date('2030-01-02T00:00:00Z'));
  });
  it('preflights missing or retired roles and missing radio references before any creation', async () => {
    mocks.db.squadRole.findMany.mockResolvedValue([]);
    expect((await POST(req())).status).toBe(404);
    mocks.db.squadRole.findMany.mockResolvedValue([{ id: 7, isRetired: true }]);
    expect((await POST(req())).status).toBe(409);
    mocks.db.squadRole.findMany.mockResolvedValue([{ id: 7, isRetired: false }]);
    mocks.db.radioFrequency.findMany.mockResolvedValue([]);
    expect((await POST(req({ ...payload(), frequencyIds: [8] }))).status).toBe(404);
    expect(mocks.db.orbat.create).not.toHaveBeenCalled();
  });
  it.each(['P2002', 'P2003', 'P2034', 'P2025'])('maps database reference/concurrency error %s', async code => {
    mocks.db.$transaction.mockRejectedValue({ code });
    expect((await POST(req())).status).toBe(code === 'P2025' ? 404 : 409);
    expect(mocks.publish).not.toHaveBeenCalled();
  });
  it.each(['slot', 'botEvent', 'apiAuditLog'] as const)('propagates %s failure out of transaction without publishing', async model => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.db[model].create.mockRejectedValue(new Error('private database outage'));
    const response = await POST(req());
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain('private database outage');
    expect(mocks.publish).not.toHaveBeenCalled();
    expect(mocks.catalog).not.toHaveBeenCalled();
    log.mockRestore();
  });
  it('keeps committed success when either realtime listener fails', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.publish.mockImplementation(() => { throw new Error('listener'); });
    mocks.catalog.mockImplementation(() => { throw new Error('listener'); });
    expect((await POST(req())).status).toBe(201);
    expect(mocks.catalog).toHaveBeenCalledTimes(1);
    expect(mocks.db.apiAuditLog.create).toHaveBeenCalledTimes(1);
    log.mockRestore();
  });
});
