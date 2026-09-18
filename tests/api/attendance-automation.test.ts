import { beforeEach, expect, test, vi } from 'vitest';
const mocks = vi.hoisted(() => { const model = () => ({ findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn() }); return { session: vi.fn(), db: { user: model(), userPermission: model(), botToken: model(), authAccount: model(), orbat: model(), signup: model(), attendance: model(), attendanceEvent: model(), attendanceSession: model(), attendanceLog: model(), orbatAttendanceNote: model(), apiAuditLog: model(), $transaction: vi.fn() } }; });
vi.mock('@/lib/prisma', () => ({ prisma: mocks.db }));
vi.mock('next-auth', () => ({ getServerSession: mocks.session }));
vi.mock('@/app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
import { POST as events } from '@/app/api/attendance/events/route';
import { POST as backfill } from '@/app/api/attendance/events/backfill/route';
import { POST as sessions } from '@/app/api/attendance/sessions/route';
import { POST as compile } from '@/app/api/orbats/[id]/attendance/compile/route';
import { compileEventMetrics } from '@/lib/api/attendance-automation';
const req = (body: unknown, authorization?: string, query = '') => new Request(`http://localhost/api/test${query}`, { method: 'POST', headers: authorization ? { authorization } : {}, body: JSON.stringify(body) });
const ctx = (id = '20') => ({ params: Promise.resolve({ id }) });
const operation = () => ({ id: 20, isSideOp: false, startsAtUtc: new Date('2020-01-01T10:00:00Z'), endsAtUtc: new Date('2020-01-01T12:00:00Z'), eventDate: null });
const event = () => ({ id: 30, userId: 4, steamId: null, discordId: null, isJoin: true, eventTime: new Date('2020-01-01T10:00:00Z'), processed: true });
const session = () => ({ id: 40, userId: 4, attendanceId: null, checkedInAt: new Date('2020-01-01T10:00:00Z'), checkedOutAt: null, durationMinutes: null, sessionDate: new Date('2020-01-01T00:00:00Z') });
const attendance = () => ({ id: 50, userId: 4, orbatId: 20, signupId: 60, status: 'no_show', totalMinutesPresent: 0, minutesLate: 0, minutesGoneEarly: 0, totalMinutesMissed: 0 });
beforeEach(() => {
  vi.resetAllMocks(); mocks.session.mockResolvedValue({ user: { id: 4 } }); mocks.db.user.findUnique.mockResolvedValue({ id: 4, userPermissions: [{ permission: { key: 'attendance:edit' }, value: 2 }] }); mocks.db.userPermission.findMany.mockResolvedValue([]); mocks.db.botToken.findFirst.mockResolvedValue({ id: 9 });
  mocks.db.orbat.findUnique.mockResolvedValue(operation()); mocks.db.attendanceEvent.create.mockImplementation(async ({ data }) => ({ ...event(), ...data })); mocks.db.attendanceEvent.findMany.mockResolvedValue([]); mocks.db.signup.findMany.mockResolvedValue([{ id: 60, userId: 4, slot: { orbat: operation() } }]); mocks.db.signup.findFirst.mockResolvedValue({ id: 60 });
  mocks.db.attendance.create.mockImplementation(async ({ data }) => ({ ...attendance(), ...data })); mocks.db.attendance.update.mockImplementation(async ({ data }) => ({ ...attendance(), ...data })); mocks.db.orbatAttendanceNote.findMany.mockResolvedValue([]); mocks.db.orbatAttendanceNote.findUnique.mockResolvedValue(null);
  mocks.db.attendanceSession.create.mockImplementation(async ({ data }) => ({ ...session(), ...data })); mocks.db.attendanceSession.update.mockImplementation(async ({ data }) => ({ ...session(), ...data })); mocks.db.attendanceSession.findMany.mockResolvedValue([session()]);
  mocks.db.$transaction.mockImplementation(async cb => cb(mocks.db));
});
const calls = [['events', (auth?: string) => events(req({ userId: 4, isJoin: true, eventTime: '2020-01-01T10:00:00Z' }, auth))], ['backfill', (auth?: string) => backfill(req({}, auth))], ['sessions', (auth?: string) => sessions(req({ userId: 4, checkinTime: '2020-01-01T10:00:00Z' }, auth))], ['compile', (auth?: string) => compile(req({}, auth), ctx())]] as const;
test.each(calls)('%s requires authenticated global grants; active bot uses same route', async (_name, call) => { expect((await call('Bearer active')).status).toBe(_name === 'events' ? 201 : 200); mocks.session.mockResolvedValue(null); expect((await call()).status).toBe(401); mocks.session.mockResolvedValue({ user: { id: 4 } }); mocks.db.user.findUnique.mockResolvedValue({ userPermissions: [] }); expect((await call()).status).toBe(403); mocks.db.botToken.findFirst.mockResolvedValue(null); expect((await call('Bearer invalid')).status).toBe(401); });
test.each([{}, { userId: 4, isJoin: 'true', eventTime: '2020-01-01T10:00:00Z' }, { userId: '4', isJoin: true, eventTime: '2020-01-01T10:00:00Z' }, { userId: 4, identity: { provider: 'steam', providerUserId: '76561198000000000' }, isJoin: true, eventTime: '2020-01-01T10:00:00Z' }, { identity: { provider: 'bad', providerUserId: '1' }, isJoin: true, eventTime: '2020-01-01T10:00:00Z' }, { userId: 4, isJoin: true, eventTime: '2020-01-01T10:00:00' }])('event strict payload %#', async body => { expect((await events(req(body))).status).toBe(422); expect(mocks.db.attendanceEvent.create).not.toHaveBeenCalled(); });
test('unknown identities stay pending, are scoped correctly, and identifiers never enter audit', async () => {
  const response = await events(req({ identity: { provider: 'steam', providerUserId: '76561198000000000' }, isJoin: true, eventTime: '2020-01-01T12:00:00+02:00' })); expect(response.status).toBe(201); expect((await response.json()).data).toMatchObject({ userId: null, processed: false, eventTime: '2020-01-01T10:00:00.000Z' });
  expect(mocks.db.attendanceEvent.findFirst.mock.lastCall![0].where).toEqual({ steamId: '76561198000000000' }); expect(JSON.stringify(mocks.db.apiAuditLog.create.mock.lastCall![0])).not.toContain('76561198000000000');
});
test('event duplicate suppression is scoped and preserves out-of-order distinct events', async () => {
  mocks.db.attendanceEvent.findFirst.mockResolvedValue(event());
  const body = { userId: 4, isJoin: true, eventTime: '2020-01-01T10:01:00Z' }; const response = await events(req(body)); expect(response.status).toBe(200); expect((await response.json()).meta.duplicate).toBe(true); expect(mocks.db.attendanceEvent.create).not.toHaveBeenCalled();
  expect((await events(req({ ...body, eventTime: '2020-01-01T09:59:00Z' }))).status).toBe(201);
});
test('event-linked user hierarchy is live', async () => { mocks.db.authAccount.findUnique.mockResolvedValue({ userId: 5 }); mocks.db.userPermission.findMany.mockResolvedValue([{ permission: { key: 'attendance:edit' }, value: 3 }]); expect((await events(req({ identity: { provider: 'discord', providerUserId: '123456789012345678' }, isJoin: true, eventTime: '2020-01-01T10:00:00Z' }))).status).toBe(403); });
test('backfill preflights all matches, preserves unmatched rows and actual cursor boundary', async () => {
  mocks.db.attendanceEvent.findMany.mockResolvedValue([{ ...event(), processed: false, userId: null, steamId: '76561198000000000' }, { ...event(), id: 31, processed: false, userId: null }]); mocks.db.authAccount.findUnique.mockResolvedValue({ userId: 5 });
  const response = await backfill(req({ limit: 1 })); expect(await response.json()).toEqual({ data: { scannedCount: 1, linkedCount: 1 }, meta: { limit: 1, nextCursor: '30' } }); expect(mocks.db.attendanceEvent.update).toHaveBeenCalledWith({ where: { id: 30 }, data: { userId: 5, processed: true } });
  mocks.db.attendanceEvent.findMany.mockResolvedValue([{ ...event(), processed: false, userId: null }]); expect((await (await backfill(req({ cursor: 30 }))).json()).data.linkedCount).toBe(0);
});
test('conflicting backfill identities and out-of-scope users stop every write', async () => { mocks.db.attendanceEvent.findMany.mockResolvedValue([{ ...event(), processed: false, userId: null, steamId: '76561198000000000', discordId: '123456789012345678' }]); mocks.db.authAccount.findUnique.mockResolvedValueOnce({ userId: 5 }).mockResolvedValueOnce({ userId: 6 }); expect((await backfill(req({}))).status).toBe(409); expect(mocks.db.attendanceEvent.update).not.toHaveBeenCalled(); expect((await backfill(req({ limit: 1001 }))).status).toBe(422); });
test('compiler pure arithmetic preserves no-show, clamped segments and start-only full-presence rule', () => {
  const { startsAtUtc: start, endsAtUtc: end } = operation();
  expect(compileEventMetrics([], start, end)).toMatchObject({ status: 'no_show', totalMinutesPresent: 0 });
  expect(compileEventMetrics([{ isJoin: true, eventTime: new Date('2020-01-01T11:00:00Z') }], start, end)).toMatchObject({ status: 'present', totalMinutesPresent: 120, minutesLate: 0 });
  expect(compileEventMetrics([{ isJoin: true, eventTime: new Date('2020-01-01T09:00:00Z') }, { isJoin: false, eventTime: new Date('2020-01-01T13:00:00Z') }], start, end)).toMatchObject({ status: 'present', totalMinutesPresent: 120 });
  expect(compileEventMetrics([{ isJoin: true, eventTime: new Date('2020-01-01T10:30:00Z') }, { isJoin: false, eventTime: new Date('2020-01-01T11:30:00Z') }], start, end)).toMatchObject({ status: 'partial', totalMinutesPresent: 60, totalMinutesMissed: 60 });
});
test('compiler checks operation and all users before writing then audits each result', async () => { expect((await compile(req({}), ctx())).status).toBe(200); expect(mocks.db.attendance.create.mock.lastCall![0].data.status).toBe('no_show'); expect(mocks.db.apiAuditLog.create.mock.lastCall![0].data.action).toBe('attendance.compiled'); mocks.db.orbat.findUnique.mockResolvedValue({ ...operation(), isSideOp: true }); expect((await compile(req({}), ctx())).status).toBe(409); mocks.db.orbat.findUnique.mockResolvedValue({ ...operation(), endsAtUtc: null }); expect((await compile(req({}), ctx())).status).toBe(422); });
test.each([{}, { userId: '4', checkinTime: '2020-01-01T10:00:00Z' }, { userId: 4, checkinTime: '2020-01-01T12:00:00Z', checkoutTime: '2020-01-01T10:00:00Z' }, { userId: 4, checkinTime: '2020-01-01T10:00:00', notes: 'legacy' }])('session payload %# rejects before writes', async body => { expect((await sessions(req(body))).status).toBe(422); });
test('session records strict UTC attached/unattached mode and existing grace-window semantics', async () => {
  const response = await sessions(req({ userId: 4, checkinTime: '2020-01-01T12:00:00+02:00', checkoutTime: '2020-01-01T14:00:00+02:00' })); expect(response.status).toBe(200); expect((await response.json()).data.session).toMatchObject({ checkedInAt: '2020-01-01T10:00:00.000Z', checkedOutAt: '2020-01-01T12:00:00.000Z', durationMinutes: 120, attendanceId: null });
  expect(mocks.db.apiAuditLog.create.mock.lastCall![0].data.action).toBe('attendance_session.recorded');
  expect((await sessions(req({ userId: 4, orbatId: 20, checkinTime: '2020-01-01T10:00:00Z' }))).status).toBe(200);
  expect(mocks.db.attendanceSession.create.mock.lastCall![0].data.attendanceId).toBe(50);
});
test('session chronology rejects missing checkout source, duplicate open session, sideop and invalid stored checkout', async () => {
  expect((await sessions(req({ userId: 4, checkoutTime: '2020-01-01T12:00:00Z' }))).status).toBe(409);
  mocks.db.attendanceSession.findFirst.mockResolvedValue(session());
  expect((await sessions(req({ userId: 4, checkinTime: '2020-01-01T11:00:00Z' }))).status).toBe(409);
  expect((await sessions(req({ userId: 4, checkoutTime: '2020-01-01T09:00:00Z' }))).status).toBe(422);
  mocks.db.orbat.findUnique.mockResolvedValue({ ...operation(), isSideOp: true }); expect((await sessions(req({ userId: 4, orbatId: 20, checkinTime: '2020-01-01T10:00:00Z' }))).status).toBe(409);
});
test('automation effects and audits fail atomically with safe errors', async () => { const log = vi.spyOn(console, 'error').mockImplementation(() => {}); mocks.db.apiAuditLog.create.mockRejectedValue(new Error('private failure')); expect((await events(req({ userId: 4, isJoin: true, eventTime: '2020-01-01T10:00:00Z' }))).status).toBe(500); expect((await sessions(req({ userId: 4, checkinTime: '2020-01-01T10:00:00Z' }))).status).toBe(500); expect((await compile(req({}), ctx())).status).toBe(500); log.mockRestore(); });
