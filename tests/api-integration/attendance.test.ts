import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import type { Prisma } from '@/generated/prisma/client';
const session = vi.hoisted(() => ({ id: null as number | null }));
vi.mock('next-auth', () => ({ getServerSession: async () => session.id === null ? null : { user: { id: session.id } } }));
vi.mock('@/app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
import { prisma } from '@/lib/prisma';
import { GET, PATCH, DELETE } from '@/app/api/attendance/[attendanceId]/route';
import { GET as list, POST } from '@/app/api/orbats/[id]/attendance/route';
import { GET as history } from '@/app/api/users/[id]/attendance/route';
import { GET as stats } from '@/app/api/users/[id]/attendance/stats/route';
let actor: number, member: number, other: number, superior: number, token: string;
const req = (method: string, body?: unknown, query = '', auth?: string) => new Request(`http://localhost/api/test${query}`, { method, headers: auth ? { authorization: auth } : {}, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const ctx = (attendanceId: number) => ({ params: Promise.resolve({ attendanceId: String(attendanceId) }) });
const operationCtx = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) });
async function fixture(isSideOp = false) { return prisma.orbat.create({ data: { name: 'Manual attendance integration', createdById: actor, startsAtUtc: new Date('2020-01-01T10:00:00Z'), endsAtUtc: new Date('2020-01-01T12:00:00Z'), isSideOp } }); }
beforeAll(async () => {
  if (!process.env.API_INTEGRATION_DATABASE_URL || process.env.DATABASE_URL !== process.env.API_INTEGRATION_DATABASE_URL) throw new Error('Isolated integration database required');
  const permissions = await Promise.all(['attendance:view', 'attendance:edit'].map(key => prisma.permission.upsert({ where: { key }, create: { key }, update: {} })));
  actor = (await prisma.user.create({ data: { username: 'Attendance integration actor', email: 'private-attendance@example.test', userPermissions: { create: permissions.map(permission => ({ permissionId: permission.id, value: 2 })) } } })).id;
  member = (await prisma.user.create({ data: { username: 'Attendance integration member' } })).id;
  other = (await prisma.user.create({ data: { username: 'Attendance integration other' } })).id;
  superior = (await prisma.user.create({ data: { username: 'Attendance integration superior', userPermissions: { create: permissions.map(permission => ({ permissionId: permission.id, value: 3 })) } } })).id;
  token = (await prisma.botToken.create({ data: { name: 'Attendance integration token', token: 'attendance-manual-integration-token' } })).token;
});
beforeEach(() => { session.id = actor; });
afterAll(async () => { await prisma.$disconnect(); });
test('manual creation uses UTC duration arithmetic, note flags and atomic log/audit', async () => {
  const orbat = await fixture(); await prisma.orbatAttendanceNote.create({ data: { orbatId: orbat.id, userId: member, status: 'late_unsure', lateMinutes: 15 } });
  const response = await POST(req('POST', { userId: member, checkinTime: '2020-01-01T12:15:00+02:00', checkoutTime: '2020-01-01T13:45:00+02:00', notes: ' Private attendance note ' }), operationCtx(orbat.id)); expect(response.status).toBe(201);
  const { data } = await response.json(); expect(data).toMatchObject({ userId: member, status: 'present', totalMinutesPresent: 90, totalMinutesMissed: 0, notedLateEarly: true, notedUnsure: true, notes: 'Private attendance note' });
  expect(data.sessions[0]).toMatchObject({ checkedInAt: '2020-01-01T10:15:00.000Z', checkedOutAt: '2020-01-01T11:45:00.000Z', sessionDate: '2020-01-01T00:00:00.000Z', durationMinutes: 90 });
  expect(data.logs[0].changedBy).toEqual({ id: actor, username: 'Attendance integration actor' }); expect(JSON.stringify(data)).not.toContain('private-attendance@example.test');
  const audit = await prisma.apiAuditLog.findFirstOrThrow({ where: { correlationId: response.headers.get('X-Request-Id')! } }); expect(audit.targetUserIds).toEqual([member]); expect(JSON.stringify(audit)).not.toContain('Private attendance note');
});
test('PATCH preserves omitted fields, reassigns session owner consistently and DELETE captures cascade IDs', async () => {
  const orbat = await fixture(); const created = await POST(req('POST', { userId: member, status: 'absent', notes: 'Keep', checkinTime: '2020-01-01T10:00:00Z' }), operationCtx(orbat.id)); const { data } = await created.json();
  const changed = await PATCH(req('PATCH', { notes: null }), ctx(data.id)); expect((await changed.json()).data).toMatchObject({ status: 'absent', signupId: null, userId: member, notes: null });
  expect((await PATCH(req('PATCH', { userId: other }), ctx(data.id))).status).toBe(200); expect((await prisma.attendanceSession.findFirstOrThrow({ where: { attendanceId: data.id } })).userId).toBe(other);
  const removed = await DELETE(req('DELETE'), ctx(data.id)); expect((await removed.json()).data).toBeNull(); expect(await prisma.attendanceSession.count({ where: { attendanceId: data.id } })).toBe(0);
  const audit = await prisma.apiAuditLog.findFirstOrThrow({ where: { correlationId: removed.headers.get('X-Request-Id')! } }); expect(audit.before).toMatchObject({ sessionIds: [data.sessions[0].id] }); expect(audit.targetUserIds).toEqual([other]);
});
test('sideops, duplicate users, owned signup and hierarchy checks prevent invalid writes', async () => {
  const side = await fixture(true); expect((await POST(req('POST', { userId: member }), operationCtx(side.id))).status).toBe(409);
  const orbat = await fixture(); expect((await POST(req('POST', { userId: superior }), operationCtx(orbat.id))).status).toBe(403);
  expect((await POST(req('POST', { userId: member }), operationCtx(orbat.id))).status).toBe(201); expect((await POST(req('POST', { userId: member }), operationCtx(orbat.id))).status).toBe(409);
  const squad = await prisma.squad.create({ data: { orbatId: side.id, name: 'S', orderIndex: 0 } }); const slot = await prisma.slot.create({ data: { orbatId: side.id, squadId: squad.id, orderIndex: 0 } }); const signup = await prisma.signup.create({ data: { slotId: slot.id, userId: other } });
  expect((await POST(req('POST', { signupId: signup.id }), operationCtx(orbat.id))).status).toBe(404);
});
test('private operation list and detail require live permission, bots work, invalid bearer never falls back', async () => {
  const orbat = await fixture(); const created = await POST(req('POST', { userId: member }), operationCtx(orbat.id)); const { data } = await created.json();
  session.id = member; expect((await GET(req('GET'), ctx(data.id))).status).toBe(403); expect((await PATCH(req('PATCH', { notes: 'Self' }), ctx(data.id))).status).toBe(403);
  session.id = actor; expect((await GET(req('GET', undefined, '', 'Bearer invalid'), ctx(data.id))).status).toBe(401);
  const bot = await PATCH(req('PATCH', { status: 'late' }, '', `Bearer ${token}`), ctx(data.id)); expect(bot.status).toBe(200);
  const log = await prisma.attendanceLog.findFirstOrThrow({ where: { attendanceId: data.id }, orderBy: { id: 'desc' } }); expect(log.changedById).toBeNull();
  expect((await prisma.apiAuditLog.findFirstOrThrow({ where: { correlationId: bot.headers.get('X-Request-Id')! } })).actorType).toBe('bot');
});
test('operation lists filter UTC date before cursor and audit only returned user/actor identities', async () => {
  const orbat = await fixture(); const old = await prisma.attendance.create({ data: { orbatId: orbat.id, userId: member, createdAt: new Date('2020-01-01T23:59:59Z') } }); const recent = await prisma.attendance.create({ data: { orbatId: orbat.id, userId: other, createdAt: new Date('2020-01-02T00:00:00Z') } });
  const response = await list(req('GET', undefined, '?date=2020-01-01&limit=1'), operationCtx(orbat.id)); const body = await response.json(); expect(body.data.map((row: { id: number }) => row.id)).toEqual([old.id]); expect(body.meta.nextCursor).toBeNull();
  expect((await prisma.apiAuditLog.findFirstOrThrow({ where: { correlationId: response.headers.get('X-Request-Id')! } })).targetUserIds).toEqual([member]);
  expect((await list(req('GET', undefined, `?cursor=${recent.id}&limit=1`), operationCtx(orbat.id))).status).toBe(200);
});
test('public history/stats preserve anonymous display access but omit notes logs and private actor data', async () => {
  const orbat = await fixture(); const created = await POST(req('POST', { userId: member, status: 'present', notes: 'Never public' }), operationCtx(orbat.id)); const { data } = await created.json();
  session.id = null; const response = await history(req('GET', undefined, '?days=1&limit=1'), operationCtx(member)); expect(response.status).toBe(200); const body = await response.json(); expect(body.data[0].id).toBe(data.id); expect(body.data[0]).not.toHaveProperty('notes'); expect(body.data[0]).not.toHaveProperty('logs'); expect(body.data[0]).not.toHaveProperty('user');
  expect((await prisma.apiAuditLog.findFirstOrThrow({ where: { correlationId: response.headers.get('X-Request-Id')! } })).actorType).toBe('anonymous');
  const summary = await stats(req('GET', undefined, '?days=1'), operationCtx(member)); expect((await summary.json()).data.totalEvents).toBeGreaterThan(0);
  expect((await history(req('GET', undefined, '', 'Bearer invalid'), operationCtx(member))).status).toBe(401);
  session.id = member; const self = await stats(req('GET'), operationCtx('me')); expect(self.status).toBe(200); expect(await prisma.apiAuditLog.count({ where: { correlationId: self.headers.get('X-Request-Id')! } })).toBe(0);
});
test('real transaction audit failure rolls back attendance sessions logs and deletion cascades', async () => {
  const orbat = await fixture(); const response = await POST(req('POST', { userId: member, checkinTime: '2020-01-01T10:00:00Z' }), operationCtx(orbat.id)); const { data } = await response.json();
  const transaction = prisma.$transaction.bind(prisma); const spy = vi.spyOn(prisma, '$transaction').mockImplementation(((callback: (tx: Prisma.TransactionClient) => unknown, options: unknown) => transaction(async tx => {
    const original = tx.apiAuditLog.create; tx.apiAuditLog.create = (() => { throw new Error('Injected audit failure'); }) as typeof original;
    try { return await callback(tx); } finally { tx.apiAuditLog.create = original; }
  }, options as never)) as typeof prisma.$transaction); const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  try { expect((await DELETE(req('DELETE'), ctx(data.id))).status).toBe(500); expect((await POST(req('POST', { userId: other, checkinTime: '2020-01-01T10:00:00Z' }), operationCtx(orbat.id))).status).toBe(500); } finally { spy.mockRestore(); log.mockRestore(); }
  expect(await prisma.attendance.findUnique({ where: { id: data.id } })).not.toBeNull(); expect(await prisma.attendanceSession.count({ where: { attendanceId: data.id } })).toBe(1); expect(await prisma.attendance.count({ where: { orbatId: orbat.id, userId: other } })).toBe(0);
});
