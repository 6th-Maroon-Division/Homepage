import { beforeEach, expect, test, vi } from 'vitest';
const mocks = vi.hoisted(() => {
  const model = () => ({ findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn(), update: vi.fn(), create: vi.fn(), createMany: vi.fn(), delete: vi.fn(), deleteMany: vi.fn() });
  return { session: vi.fn(), publish: vi.fn(), catalog: vi.fn(), db: { user: model(), botToken: model(), orbat: model(), squad: model(), slot: model(), squadRole: model(), radioFrequency: model(), orbatRadioFrequency: model(), botEvent: model(), apiAuditLog: model(), $transaction: vi.fn() } };
});
vi.mock('@/lib/prisma', () => ({ prisma: mocks.db }));
vi.mock('next-auth', () => ({ getServerSession: mocks.session }));
vi.mock('@/app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
vi.mock('@/lib/realtime/orbat-events', () => ({ publishOrbatEvent: mocks.publish }));
vi.mock('@/lib/realtime/admin-catalog-events', () => ({ publishAdminCatalogEvent: mocks.catalog }));
import { GET, PATCH, DELETE } from '@/app/api/orbats/[id]/route';
const context = (id = '20') => ({ params: Promise.resolve({ id }) });
const request = (method = 'PATCH', body: unknown = { name: 'New' }, auth?: string, query = '') => new Request(`http://localhost/api/orbats/20${query}`, { method, headers: auth ? { authorization: auth } : {}, ...(method === 'PATCH' ? { body: JSON.stringify(body) } : {}) });
const saved = () => ({ id: 20, name: 'Old', description: 'private text', createdById: 5, createdAt: new Date('2020-01-01T00:00:00Z'), startsAtUtc: null, endsAtUtc: null, eventDate: null, squads: [{ id: 21, orderIndex: 0, slots: [{ id: 22, orderIndex: 0, maxSignups: 1, squadRoleId: 7, signups: [{ id: 40, userId: 6 }] }, { id: 23, orderIndex: 2147483647, maxSignups: 1, squadRoleId: null, signups: [] }] }], frequencies: [{ id: 24, radioFrequencyId: 8 }], attendances: [{ id: 50, userId: 6, signupId: 40, sessions: [{ id: 51 }], logs: [{ id: 52 }] }], attendanceNotes: [{ id: 53, userId: 7 }], trainingStatusChanges: [{ id: 54, userTraining: { userId: 8 } }] });
const replacement = () => ({ squads: [{ id: 21, name: 'A', orderIndex: 0, slots: [{ id: 23, orderIndex: 0, maxSignups: 2 }, { id: 22, orderIndex: 1, maxSignups: 3, squadRoleId: 7 }] }] });
beforeEach(() => {
  vi.resetAllMocks(); mocks.session.mockResolvedValue({ user: { id: 4 } });
  mocks.db.user.findUnique.mockResolvedValue({ userPermissions: ['orbat:edit', 'orbat:delete'].map(key => ({ permission: { key }, value: 1 })) });
  mocks.db.botToken.findFirst.mockResolvedValue({ id: 9 });
  mocks.db.orbat.findUnique.mockResolvedValue(saved()); mocks.db.orbat.findUniqueOrThrow.mockResolvedValue(saved());
  mocks.db.squadRole.findMany.mockResolvedValue([{ id: 7, isRetired: false }]); mocks.db.radioFrequency.count.mockResolvedValue(1);
  mocks.db.squad.update.mockResolvedValue({ id: 21 }); mocks.db.squad.create.mockResolvedValue({ id: 31 });
  mocks.db.$transaction.mockImplementation(async cb => cb(mocks.db));
});
const methods = [['GET', GET], ['PATCH', PATCH], ['DELETE', DELETE]] as const;
test.each(methods)('%s requires live user grants or valid bot and rejects invalid explicit credentials', async (method, handler) => {
  expect((await handler(request(method), context())).status).toBe(200);
  expect((await handler(request(method, undefined, 'Bearer active'), context())).status).toBe(200);
  mocks.db.botToken.findFirst.mockResolvedValue(null);
  expect((await handler(request(method, undefined, 'Bearer revoked'), context())).status).toBe(401);
  mocks.db.user.findUnique.mockResolvedValue({ userPermissions: [] });
  expect((await handler(request(method), context())).status).toBe(403);
  mocks.session.mockResolvedValue(null);
  expect((await handler(request(method), context())).status).toBe(401);
});
test.each(methods)('%s rejects invalid paths/query and missing operations', async (method, handler) => {
  expect((await handler(request(method), context('2147483648'))).status).toBe(400);
  expect((await handler(request(method, undefined, undefined, '?old=1'), context())).status).toBe(400);
  mocks.db.orbat.findUnique.mockResolvedValue(null);
  expect((await handler(request(method), context())).status).toBe(404);
});
test('GET selects editor catalog without signup or creator identities and normalizes UTC', async () => {
  mocks.db.orbat.findUnique.mockResolvedValue({ ...saved(), squads: [], attendances: undefined, attendanceNotes: undefined, trainingStatusChanges: undefined, eventDate: new Date('2020-01-01T00:00:00Z') });
  const data = (await (await GET(request('GET'), context())).json()).data;
  expect(data.createdById).toBeUndefined(); expect(data.createdAt).toBeUndefined();
  expect(data.eventDate).toBe('2020-01-01T00:00:00.000Z'); expect(data.frequencyIds).toEqual([8]);
  expect(mocks.db.orbat.findUnique.mock.lastCall![0].include.squads.include.slots.include).not.toHaveProperty('signups');
  expect(mocks.db.apiAuditLog.create).not.toHaveBeenCalled();
});
test.each([null, {}, [], { eventDate: '2020-01-01' }, { name: '' }, { squads: [] }, { squads: [null] }, { squads: [{ ...replacement().squads[0], id: '21' }] }, { squads: [{ ...replacement().squads[0], slots: [{ id: 22, orderIndex: 0, maxSignups: 1 }, { id: 22, orderIndex: 1, maxSignups: 1 }] }] }, { squads: [{ ...replacement().squads[0], slots: [{ id: 22, name: 'legacy', orderIndex: 0, maxSignups: 1 }] }] }, { squads: [{ ...replacement().squads[0], _deleted: true }] }, { frequencyIds: [8, 8] }, { startsAtUtc: '2020-01-01T00:00:00' }])('rejects invalid partial payload %#', async body => {
  expect((await PATCH(request('PATCH', body), context())).status).toBe(422); expect(mocks.db.$transaction).not.toHaveBeenCalled();
});
test('partial updates preserve omitted dates and collections and accept past UTC instants', async () => {
  expect((await PATCH(request('PATCH', { description: null }), context())).status).toBe(200);
  expect(mocks.db.orbat.update).toHaveBeenCalledWith({ where: { id: 20 }, data: { description: null } });
  expect(mocks.db.slot.deleteMany).not.toHaveBeenCalled(); expect(mocks.db.orbatRadioFrequency.deleteMany).not.toHaveBeenCalled();
  expect((await PATCH(request('PATCH', { startsAtUtc: '2020-01-01T12:00:00+02:00' }), context())).status).toBe(200);
  expect(mocks.db.orbat.update.mock.lastCall![0].data).toMatchObject({ startsAtUtc: new Date('2020-01-01T10:00:00Z'), startTime: '10:00' });
  expect(mocks.db.$transaction.mock.lastCall![1]).toEqual({ isolationLevel: 'Serializable' });
});
test('merged timing and foreign nested IDs fail before writes', async () => {
  expect((await PATCH(request('PATCH', { endsAtUtc: '2020-01-01T10:00:00Z' }), context())).status).toBe(422);
  expect((await PATCH(request('PATCH', { squads: [{ ...replacement().squads[0], id: 999 }] }), context())).status).toBe(404);
  expect((await PATCH(request('PATCH', { squads: [{ ...replacement().squads[0], slots: [{ id: 999, orderIndex: 0, maxSignups: 1 }] }] }), context())).status).toBe(404);
  expect(mocks.db.orbat.update).not.toHaveBeenCalled();
});
test('checks roles/radios before mutation', async () => {
  mocks.db.squadRole.findMany.mockResolvedValue([]);
  expect((await PATCH(request('PATCH', replacement()), context())).status).toBe(404);
  mocks.db.squadRole.findMany.mockResolvedValue([{ id: 7, isRetired: true }]);
  expect((await PATCH(request('PATCH', replacement()), context())).status).toBe(409);
  mocks.db.radioFrequency.count.mockResolvedValue(0);
  expect((await PATCH(request('PATCH', { frequencyIds: [8] }), context())).status).toBe(404);
  expect(mocks.db.orbat.update).not.toHaveBeenCalled();
});
test('retains IDs through swaps using negative staging and clear/replaces radios', async () => {
  expect((await PATCH(request('PATCH', { ...replacement(), frequencyIds: [8] }), context())).status).toBe(200);
  expect(mocks.db.slot.update.mock.calls.slice(0, 2).map(call => call[0].data.orderIndex)).toEqual([-1, -2]);
  expect(mocks.db.slot.deleteMany).toHaveBeenCalledWith({ where: { id: { in: [] } } });
  expect(mocks.db.slot.update.mock.calls[2][0]).toMatchObject({ where: { id: 23 }, data: { squadId: 21, orderIndex: 0, maxSignups: 2 } });
  expect(mocks.db.orbatRadioFrequency.createMany).toHaveBeenCalledWith({ data: [{ orbatId: 20, radioFrequencyId: 8 }] });
  expect(mocks.db.apiAuditLog.create.mock.lastCall![0].data.targetUserIds).toEqual([]);
});
test('new squads/slots and omitted signed-up slots produce affected-user audit', async () => {
  expect((await PATCH(request('PATCH', { squads: [{ name: 'New', orderIndex: 0, slots: [{ orderIndex: 0, maxSignups: 1 }] }], frequencyIds: [] }), context())).status).toBe(200);
  expect(mocks.db.slot.create).toHaveBeenCalledWith({ data: { orbatId: 20, squadId: 31, orderIndex: 0, maxSignups: 1, squadRoleId: null } });
  expect(mocks.db.apiAuditLog.create.mock.lastCall![0].data.targetUserIds).toEqual([6]);
});
test('delete records cascade identifiers without personal notes and returns null', async () => {
  expect(await (await DELETE(request('DELETE'), context())).json()).toEqual({ data: null, meta: {} });
  const audit = mocks.db.apiAuditLog.create.mock.lastCall![0].data;
  expect(audit).toMatchObject({ action: 'orbat.deleted', targetUserIds: [6, 7, 8], after: { deleted: true }, before: { attendanceSessionIds: [51], attendanceLogIds: [52], trainingStatusChangeIds: [54] } });
  expect(JSON.stringify(audit)).not.toContain('private text');
  expect(mocks.db.botEvent.create.mock.lastCall![0].data.type).toBe('orbat.deleted');
});
test.each(['P2002', 'P2003', 'P2034', 'P2025'])('maps transactional %s failures', async code => {
  mocks.db.$transaction.mockRejectedValue({ code });
  expect((await PATCH(request(), context())).status).toBe(code === 'P2025' ? 404 : 409);
  expect(mocks.publish).not.toHaveBeenCalled();
});
test('audit/outbox failures fail atomically before realtime, listener failures preserve success', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  mocks.db.apiAuditLog.create.mockRejectedValue(new Error('audit outage'));
  expect((await DELETE(request('DELETE'), context())).status).toBe(500); expect(mocks.publish).not.toHaveBeenCalled();
  mocks.db.apiAuditLog.create.mockResolvedValue({}); mocks.db.botEvent.create.mockRejectedValue(new Error('outbox outage'));
  expect((await PATCH(request(), context())).status).toBe(500);
  mocks.db.botEvent.create.mockResolvedValue({}); mocks.publish.mockImplementation(() => { throw new Error('listener'); }); mocks.catalog.mockImplementation(() => { throw new Error('listener'); });
  expect((await PATCH(request(), context())).status).toBe(200); expect(mocks.catalog).toHaveBeenCalled(); log.mockRestore();
});
