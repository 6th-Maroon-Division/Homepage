import { beforeEach, expect, test, vi } from 'vitest';
const mocks = vi.hoisted(() => { const model = () => ({ findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), delete: vi.fn() }); return { session: vi.fn(), db: { user: model(), userPermission: model(), botToken: model(), orbat: model(), signup: model(), attendance: model(), attendanceSession: model(), attendanceLog: model(), orbatAttendanceNote: model(), apiAuditLog: model(), $transaction: vi.fn() } }; });
vi.mock('@/lib/prisma', () => ({ prisma: mocks.db }));
vi.mock('next-auth', () => ({ getServerSession: mocks.session }));
vi.mock('@/app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
import { GET, PATCH, DELETE } from '@/app/api/attendance/[attendanceId]/route';
import { GET as list, POST } from '@/app/api/orbats/[id]/attendance/route';
const ctx = (attendanceId = '30') => ({ params: Promise.resolve({ attendanceId }) });
const operationCtx = (id = '20') => ({ params: Promise.resolve({ id }) });
const req = (method: string, body?: unknown, query = '', authorization?: string) => new Request(`http://localhost/api/test${query}`, { method, headers: authorization ? { authorization } : {}, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const operation = () => ({ id: 20, name: 'Operation', isSideOp: false, startsAtUtc: new Date('2020-01-01T10:00:00Z'), endsAtUtc: new Date('2020-01-01T12:00:00Z'), eventDate: null });
const row = () => ({ id: 30, userId: 4, signupId: null, orbatId: 20, status: 'present', notes: 'Private note', createdAt: new Date('2020-01-01T00:00:00Z'), updatedAt: new Date('2020-01-01T00:00:00Z'), minutesLate: 0, minutesGoneEarly: 0, totalMinutesMissed: 0, totalMinutesPresent: 120, notedAbsent: false, notedUnsure: false, notedLateEarly: false, user: { id: 4, username: 'U' }, orbat: operation(), signup: null, sessions: [], logs: [] });
beforeEach(() => { vi.resetAllMocks(); mocks.session.mockResolvedValue({ user: { id: 4 } }); mocks.db.user.findUnique.mockResolvedValue({ id: 4, userPermissions: ['attendance:view', 'attendance:edit'].map(key => ({ permission: { key }, value: 2 })) }); mocks.db.userPermission.findMany.mockResolvedValue([]); mocks.db.botToken.findFirst.mockResolvedValue({ id: 9 }); mocks.db.orbat.findUnique.mockResolvedValue(operation()); mocks.db.attendance.findUnique.mockResolvedValue(row()); mocks.db.attendance.findUniqueOrThrow.mockResolvedValue(row()); mocks.db.attendance.findMany.mockResolvedValue([row()]); mocks.db.attendance.create.mockResolvedValue(row()); mocks.db.attendance.update.mockResolvedValue(row()); mocks.db.orbatAttendanceNote.findUnique.mockResolvedValue(null); mocks.db.$transaction.mockImplementation(async cb => cb(mocks.db)); });
const methods = [['get', () => GET(req('GET'), ctx())], ['list', () => list(req('GET'), operationCtx())], ['create', () => POST(req('POST', { userId: 4 }), operationCtx())], ['patch', () => PATCH(req('PATCH', { status: 'late' }), ctx())], ['delete', () => DELETE(req('DELETE'), ctx())]] as const;
test.each(methods)('%s authenticates and requires global grants even for self', async (_name, call) => { expect((await call()).status).toBe(_name === 'create' ? 201 : 200); mocks.db.user.findUnique.mockResolvedValue({ id: 4, userPermissions: [] }); expect((await call()).status).toBe(403); mocks.session.mockResolvedValue(null); expect((await call()).status).toBe(401); });
test('bots access same endpoints and explicit invalid tokens cannot fall back', async () => { expect((await POST(req('POST', { userId: 5 }, '', 'Bearer active'), operationCtx())).status).toBe(201); expect(mocks.db.attendanceLog.create.mock.lastCall![0].data.changedById).toBeNull(); mocks.db.botToken.findFirst.mockResolvedValue(null); expect((await GET(req('GET', undefined, '', 'Bearer invalid'), ctx())).status).toBe(401); });
test.each([{}, null, [], { userId: '4' }, { userId: 4, status: 'invalid' }, { userId: 4, unknown: 1 }, { userId: 4, notes: 1 }, { userId: 4, checkinTime: '2020-01-01T10:00:00' }, { userId: 4, checkoutTime: '2020-01-01T10:00:00Z' }, { userId: 4, checkinTime: '2020-01-01T12:00:00Z', checkoutTime: '2020-01-01T10:00:00Z' }])('validates create payload %# before writes', async body => { expect((await POST(req('POST', body), operationCtx())).status).toBe(422); expect(mocks.db.$transaction).not.toHaveBeenCalled(); });
test('invalid path, query, JSON and reference cases use proper errors', async () => { expect((await GET(req('GET'), ctx('2147483648'))).status).toBe(400); expect((await GET(req('GET', undefined, '?old=1'), ctx())).status).toBe(400); expect((await POST(new Request('http://localhost', { method: 'POST', body: '{' }), operationCtx())).status).toBe(400); mocks.db.signup.findUnique.mockResolvedValue(null); expect((await POST(req('POST', { signupId: 99 }), operationCtx())).status).toBe(404); mocks.db.attendance.findUnique.mockResolvedValue(null); expect((await DELETE(req('DELETE'), ctx())).status).toBe(404); });
test('rejects target hierarchy, signup mismatch, wrong operation and duplicate attendance before writes', async () => { mocks.db.userPermission.findMany.mockResolvedValue([{ permission: { key: 'attendance:edit' }, value: 3 }]); expect((await POST(req('POST', { userId: 5 }), operationCtx())).status).toBe(403); mocks.db.userPermission.findMany.mockResolvedValue([]); mocks.db.signup.findUnique.mockResolvedValue({ id: 40, userId: 5, slot: { orbatId: 20 } }); expect((await POST(req('POST', { userId: 4, signupId: 40 }), operationCtx())).status).toBe(422); mocks.db.signup.findUnique.mockResolvedValue({ id: 40, userId: 4, slot: { orbatId: 99 } }); expect((await POST(req('POST', { signupId: 40 }), operationCtx())).status).toBe(404); mocks.db.attendance.findFirst.mockResolvedValue({ id: 99 }); expect((await POST(req('POST', { userId: 4 }), operationCtx())).status).toBe(409); expect(mocks.db.attendance.create).not.toHaveBeenCalled(); });
test('side operations forbid creation/update/list but allow deleting obsolete attendance', async () => { mocks.db.orbat.findUnique.mockResolvedValue({ ...operation(), isSideOp: true }); expect((await POST(req('POST', { userId: 4 }), operationCtx())).status).toBe(409); expect((await PATCH(req('PATCH', { status: 'absent' }), ctx())).status).toBe(409); expect((await list(req('GET'), operationCtx())).status).toBe(409); expect((await DELETE(req('DELETE'), ctx())).status).toBe(200); });
test('strict UTC session creation preserves duration and attendance calculation with note flags', async () => { mocks.db.orbatAttendanceNote.findUnique.mockResolvedValue({ status: 'late_unsure', lateMinutes: 10, leaveEarlyMinutes: null }); const response = await POST(req('POST', { userId: 4, checkinTime: '2020-01-01T12:15:00+02:00', checkoutTime: '2020-01-01T13:45:00+02:00', notes: ' trimmed ' }), operationCtx()); expect(response.status).toBe(201); expect(mocks.db.attendanceSession.create.mock.lastCall![0].data).toMatchObject({ checkedInAt: new Date('2020-01-01T10:15:00Z'), checkedOutAt: new Date('2020-01-01T11:45:00Z'), durationMinutes: 90, sessionDate: new Date('2020-01-01T00:00:00Z') }); expect(mocks.db.attendance.create.mock.lastCall![0].data).toMatchObject({ notes: 'trimmed', notedLateEarly: true, notedUnsure: true }); expect(mocks.db.$transaction.mock.lastCall![1]).toEqual({ isolationLevel: 'Serializable' }); expect(JSON.stringify(mocks.db.apiAuditLog.create.mock.lastCall![0])).not.toContain('Private note'); });
test('PATCH preserves omitted fields and updates session owner on authorized reassignment', async () => { expect((await PATCH(req('PATCH', { notes: null }), ctx())).status).toBe(200); expect(mocks.db.attendance.update.mock.lastCall![0].data).not.toHaveProperty('status'); expect(mocks.db.attendance.update.mock.lastCall![0].data).toMatchObject({ userId: 4, signupId: null, notes: null }); expect((await PATCH(req('PATCH', { userId: 5 }), ctx())).status).toBe(200); expect(mocks.db.attendanceSession.updateMany).toHaveBeenCalledWith({ where: { attendanceId: 30 }, data: { userId: 5 } }); expect(mocks.db.apiAuditLog.create.mock.lastCall![0].data.targetUserIds).toEqual([5, 4]); });
test('read DTO UTC/display users and per-page audit excludes lookahead', async () => { mocks.db.attendance.findMany.mockResolvedValue([{ ...row(), userId: 5 }, { ...row(), id: 29, userId: 6 }]); const response = await list(req('GET', undefined, '?limit=1&cursor=31&date=2020-01-01'), operationCtx()); const body = await response.json(); expect(body.meta.nextCursor).toBe('30'); expect(body.data[0].createdAt).toBe('2020-01-01T00:00:00.000Z'); expect(mocks.db.apiAuditLog.create.mock.lastCall![0].data.targetUserIds).toEqual([5]); expect(mocks.db.attendance.findMany.mock.lastCall![0].where).toMatchObject({ id: { lt: 31 }, createdAt: { gte: new Date('2020-01-01T00:00:00Z'), lt: new Date('2020-01-02T00:00:00Z') } }); expect((await list(req('GET', undefined, '?date=2020-02-30'), operationCtx())).status).toBe(400); });
test('self record with another log actor logs that other-user read, failclosed', async () => { mocks.db.attendance.findUnique.mockResolvedValue({ ...row(), logs: [{ id: 50, action: 'created', source: 'manual', timestamp: new Date(), changedBy: { id: 6, username: 'Actor' } }] }); expect((await GET(req('GET'), ctx())).status).toBe(200); expect(mocks.db.apiAuditLog.create.mock.lastCall![0].data.targetUserIds).toEqual([6]); const log = vi.spyOn(console, 'error').mockImplementation(() => {}); mocks.db.apiAuditLog.create.mockRejectedValue(new Error('audit failed')); expect((await GET(req('GET'), ctx())).status).toBe(500); log.mockRestore(); });
test.each(['P2002', 'P2003', 'P2034', 'P2025'])('maps transaction failure %s', async code => { mocks.db.$transaction.mockRejectedValue({ code }); expect((await DELETE(req('DELETE'), ctx())).status).toBe(code === 'P2025' ? 404 : 409); });
test('log/audit failures propagate from transaction and deleted cascade IDs remain audit metadata', async () => { mocks.db.attendance.findUnique.mockResolvedValue({ ...row(), sessions: [{ id: 51 }], logs: [{ id: 52 }] }); expect((await DELETE(req('DELETE'), ctx())).status).toBe(200); expect(mocks.db.apiAuditLog.create.mock.lastCall![0].data.before).toMatchObject({ sessionIds: [51], logIds: [52] }); const log = vi.spyOn(console, 'error').mockImplementation(() => {}); mocks.db.attendanceLog.create.mockRejectedValue(new Error('log failed')); expect((await POST(req('POST', { userId: 4 }), operationCtx())).status).toBe(500); log.mockRestore(); });

import { GET as publicList } from '@/app/api/users/[id]/attendance/route';
import { GET as stats } from '@/app/api/users/[id]/attendance/stats/route';
test('public history preserves anonymous access with narrow projection and targeted read audit', async () => {
  mocks.session.mockResolvedValue(null);
  mocks.db.attendance.findMany.mockResolvedValue([{ id: 30, userId: 4, orbatId: 20, status: 'present', minutesLate: 0, minutesGoneEarly: 0, totalMinutesMissed: 0, totalMinutesPresent: 120, createdAt: new Date('2020-01-01T00:00:00Z'), updatedAt: new Date('2020-01-01T00:00:00Z'), orbat: { id: 20, name: 'Operation', eventDate: null, startsAtUtc: new Date('2020-01-01T10:00:00Z') } }]);
  const response = await publicList(req('GET', undefined, '?days=365&limit=1'), operationCtx('4')); expect(response.status).toBe(200);
  const body = await response.json(); expect(body.meta.nextCursor).toBeNull(); expect(body.data[0]).not.toHaveProperty('notes');
  expect(mocks.db.attendance.findMany.mock.lastCall![0].select).not.toHaveProperty('logs');
  expect(mocks.db.apiAuditLog.create.mock.lastCall![0].data).toMatchObject({ actorType: 'anonymous', targetUserIds: [4] });
});
test('public stats preserve arithmetic, allow session me with no self-read audit and reject invalid bearer', async () => {
  mocks.db.attendance.findMany.mockResolvedValue([{ status: 'late', minutesLate: 60, minutesGoneEarly: 0, totalMinutesMissed: 60 }, { status: 'absent', minutesLate: 0, minutesGoneEarly: 0, totalMinutesMissed: 0 }]);
  const response = await stats(req('GET', undefined, '?days=90'), operationCtx('me')); expect((await response.json()).data).toMatchObject({ totalEvents: 2, attendancePercentage: 50, avgMinutesMissed: 30, avgArrivedLatePerMonth: 0.33 }); expect(mocks.db.apiAuditLog.create).not.toHaveBeenCalled();
  mocks.db.botToken.findFirst.mockResolvedValue(null); expect((await stats(req('GET', undefined, '', 'Bearer invalid'), operationCtx('4'))).status).toBe(401);
});
test.each(['?days=0', '?days=3651', '?days=1&days=2', '?page=1', '?cursor=2147483648'])('public history validates query %s', async query => { expect((await publicList(req('GET', undefined, query), operationCtx('4'))).status).toBe(400); });
test('public empty results still audit target, audit fails closed and missing users404', async () => {
  mocks.session.mockResolvedValue(null); mocks.db.attendance.findMany.mockResolvedValue([]);
  expect((await publicList(req('GET'), operationCtx('4'))).status).toBe(200); expect(mocks.db.apiAuditLog.create).toHaveBeenCalled();
  expect((await stats(req('GET'), operationCtx('me'))).status).toBe(400);
  const log = vi.spyOn(console, 'error').mockImplementation(() => {}); mocks.db.apiAuditLog.create.mockRejectedValue(new Error('audit failed'));
  expect((await stats(req('GET'), operationCtx('4'))).status).toBe(500); log.mockRestore();
  mocks.db.user.findUnique.mockResolvedValue(null); expect((await publicList(req('GET'), operationCtx('4'))).status).toBe(404);
});

test('unknown database errors are internal failures and missing attendance is not found', async () => {
  mocks.db.attendance.findUnique.mockResolvedValueOnce(null);
  expect((await GET(req('GET'), ctx())).status).toBe(404);
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  mocks.db.$transaction.mockRejectedValue({ code: 'P1001' });
  try { expect((await DELETE(req('DELETE'), ctx())).status).toBe(500); } finally { log.mockRestore(); }
});

test('attendance access rejects missing target users and operations and invalid pagination', async () => {
  mocks.db.user.findUnique.mockResolvedValueOnce({ id: 4, userPermissions: [{ permission: { key: 'attendance:view' }, value: 2 }] }).mockResolvedValueOnce(null);
  expect((await GET(req('GET'), ctx())).status).toBe(404);
  mocks.db.orbat.findUnique.mockResolvedValue(null);
  expect((await list(req('GET'), operationCtx())).status).toBe(404);
  expect((await list(req('GET', undefined, '?limit=0'), operationCtx())).status).toBe(400);
});

test('filtered empty attendance lists still audit the requested other user', async () => {
  mocks.db.attendance.findMany.mockResolvedValue([]);
  expect((await list(req('GET', undefined, '?userId=5'), operationCtx())).status).toBe(200);
  expect(mocks.db.attendance.findMany.mock.lastCall![0].where.userId).toBe(5);
  expect(mocks.db.apiAuditLog.create.mock.lastCall![0].data.targetUserIds).toEqual([5]);
});

test('attendance DTO serializes sessions, nullable role definitions, and unauthored logs', async () => {
  const stamp = new Date('2020-01-01T00:00:00Z');
  mocks.db.attendance.findUnique.mockResolvedValue({ ...row(), orbat: { ...operation(), startsAtUtc: null, eventDate: stamp }, signup: { id: 40, slotId: 50, slot: { id: 50, squadRole: null } }, sessions: [{ id: 60, checkedInAt: stamp, checkedOutAt: null, sessionDate: stamp, timestamp: stamp }, { id: 61, checkedInAt: stamp, checkedOutAt: stamp, sessionDate: stamp, timestamp: stamp }], logs: [{ id: 70, timestamp: stamp, changedBy: null }] });
  const data = (await (await GET(req('GET'), ctx())).json()).data;
  expect(data.signup.slot.name).toBe('Unassigned Role');
  expect(data.orbat).toMatchObject({ startsAtUtc: null, eventDate: stamp.toISOString() });
  expect(data.sessions.map((session: { checkedOutAt: string | null }) => session.checkedOutAt)).toEqual([null, stamp.toISOString()]);
  mocks.db.attendance.findUnique.mockResolvedValue({ ...row(), signup: { id: 40, slot: { id: 50, squadRole: { name: 'Medic' } } } });
  expect((await (await GET(req('GET'), ctx())).json()).data.signup.slot.name).toBe('Medic');
});

test('attendance creation permits explicit null times and normalizes blank notes', async () => {
  expect((await POST(req('POST', { userId: 4, notes: '  ', checkinTime: null, checkoutTime: null }), operationCtx())).status).toBe(201);
  expect(mocks.db.attendance.create.mock.lastCall![0].data.notes).toBeNull();
  expect(mocks.db.attendanceSession.create).not.toHaveBeenCalled();
  expect((await POST(req('POST', { userId: null, signupId: null }), operationCtx())).status).toBe(422);
});

test('missing operation blocks mutation and a checkin-only attendance records an open session', async () => {
  mocks.db.orbat.findUnique.mockResolvedValueOnce(null);
  expect((await POST(req('POST', { userId: 4 }), operationCtx())).status).toBe(404);
  expect((await POST(req('POST', { userId: 4, checkinTime: '2020-01-01T10:00:00Z' }), operationCtx())).status).toBe(201);
  expect(mocks.db.attendanceSession.create.mock.lastCall![0].data).toMatchObject({ checkedOutAt: null, durationMinutes: null });
  expect(mocks.db.attendance.update.mock.lastCall![0].data.totalMinutesPresent).toBe(0);
});

test('nullable notes remain null in mutation snapshots and public history paginates nullable schedules', async () => {
  mocks.db.attendance.findUnique.mockResolvedValue({ ...row(), notes: null });
  expect((await DELETE(req('DELETE'), ctx())).status).toBe(200);
  expect(mocks.db.apiAuditLog.create.mock.lastCall![0].data.before.notes).toBeNull();
  mocks.db.attendance.findMany.mockResolvedValue([{ ...row(), orbat: { ...operation(), startsAtUtc: null, eventDate: new Date('2020-01-01T00:00:00Z') } }, { ...row(), id: 29 }]);
  const body = await (await publicList(req('GET', undefined, '?cursor=31&limit=1'), { params: Promise.resolve({ id: '4' }) })).json();
  expect(body.meta.nextCursor).toBe('30');
  expect(body.data[0].orbat).toMatchObject({ startsAtUtc: null, eventDate: '2020-01-01T00:00:00.000Z' });
});
