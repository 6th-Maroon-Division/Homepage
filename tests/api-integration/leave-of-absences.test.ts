import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
const session = vi.hoisted(() => ({ userId: null as number | null }));
vi.mock('next-auth', () => ({ getServerSession: async () => session.userId === null ? null : { user: { id: String(session.userId) } } }));
vi.mock('@/app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
import { prisma } from '@/lib/prisma';
import type { Prisma } from '@/generated/prisma/client';
import { GET, POST } from '@/app/api/users/[id]/leave-of-absences/route';
import { PATCH } from '@/app/api/leave-of-absences/[id]/route';
let ownerId: number;
let otherId: number;
let managerId: number;
let peerId: number;
let permissionId: number;
const ctx = (id: number | 'me') => ({ params: Promise.resolve({ id: String(id) }) });
const request = (path: string, method = 'GET', body?: unknown, token?: string) => new Request(`http://localhost/api/${path}`, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const collection = (id: number | 'me', method = 'GET', body?: unknown, token?: string, query = '') => request(`users/${id}/leave-of-absences${query}`, method, body, token);
const item = (id: number, body: unknown, token?: string) => request(`leave-of-absences/${id}`, 'PATCH', body, token);
const startDate = '2026-10-25T02:30:00+02:00';
const startUtc = '2026-10-25T00:30:00.000Z';
const secretReason = 'Private integration medical appointment';
async function fixture(userId = ownerId) {
  return prisma.leaveOfAbsence.create({ data: { userId, startDate: new Date(startUtc), reason: secretReason } });
}
beforeAll(async () => {
  if (!process.env.API_INTEGRATION_DATABASE_URL || process.env.DATABASE_URL !== process.env.API_INTEGRATION_DATABASE_URL) throw new Error('Isolated Prisma integration database required.');
  permissionId = (await prisma.permission.upsert({ where: { key: 'user:edit' }, update: {}, create: { key: 'user:edit' } })).id;
  ownerId = (await prisma.user.create({ data: { username: 'LOA integration owner' } })).id;
  otherId = (await prisma.user.create({ data: { username: 'LOA integration other' } })).id;
  managerId = (await prisma.user.create({ data: { username: 'LOA integration manager', userPermissions: { create: { permissionId, value: 10 } } } })).id;
  peerId = (await prisma.user.create({ data: { username: 'LOA integration peer', userPermissions: { create: { permissionId, value: 10 } } } })).id;
});
beforeEach(() => { session.userId = ownerId; });
afterAll(async () => { await prisma.$disconnect(); });

test('self LOA create normalizes offsets and stores private reason without copying it into audit snapshots', async () => {
  const response = await POST(collection('me', 'POST', { startDate, returnDate: '2026-10-26T02:30:00+01:00', reason: ` ${secretReason} ` }), ctx('me'));
  expect(response.status).toBe(201);
  const { data } = await response.json();
  expect(data).toMatchObject({ userId: ownerId, startDate: startUtc, returnDate: '2026-10-26T01:30:00.000Z', reason: secretReason, cancelledAt: null });
  expect(data.createdAt).toMatch(/Z$/);
  const stored = await prisma.leaveOfAbsence.findUniqueOrThrow({ where: { id: data.id } });
  expect(stored.startDate.toISOString()).toBe(startUtc);
  expect(stored.reason).toBe(secretReason);
  const audit = await prisma.apiAuditLog.findFirstOrThrow({ where: { correlationId: response.headers.get('X-Request-Id')! } });
  expect(audit).toMatchObject({ actorType: 'user', actorUserId: ownerId, action: 'leave_of_absence.created', resource: 'leave_of_absence', targetUserIds: [ownerId], method: 'POST', path: '/api/users/me/leave-of-absences' });
  expect(JSON.stringify(audit)).not.toContain(secretReason);
  expect(audit.after).toMatchObject({ reason: '[REDACTED]', startDate: startUtc });
  const self = await GET(collection('me'), ctx('me'));
  expect(self.status).toBe(200);
  expect(await prisma.apiAuditLog.count({ where: { correlationId: self.headers.get('X-Request-Id')! } })).toBe(0);
});

test('LOA updates preserve start date, edit return and reason, and support cancellation and reopening', async () => {
  const row = await fixture();
  const updated = await PATCH(item(row.id, { returnDate: '2026-10-27T05:00:00+02:00', reason: ' Updated private reason ' }), ctx(row.id));
  expect(updated.status).toBe(200);
  expect((await updated.json()).data).toMatchObject({ startDate: startUtc, returnDate: '2026-10-27T03:00:00.000Z', reason: 'Updated private reason' });
  const audit = await prisma.apiAuditLog.findFirstOrThrow({ where: { correlationId: updated.headers.get('X-Request-Id')! } });
  expect(audit).toMatchObject({ action: 'leave_of_absence.updated', method: 'PATCH', path: `/api/leave-of-absences/${row.id}` });
  expect(JSON.stringify(audit)).not.toContain(secretReason);
  expect(JSON.stringify(audit)).not.toContain('Updated private reason');
  expect(audit.before).toMatchObject({ reason: '[REDACTED]' });
  expect(audit.after).toMatchObject({ reason: '[REDACTED]' });
  const cancelled = await PATCH(item(row.id, { cancel: true }), ctx(row.id));
  expect(cancelled.status).toBe(200);
  expect((await cancelled.json()).data.cancelledAt).toMatch(/Z$/);
  const reopened = await PATCH(item(row.id, { cancel: false, returnDate: null, reason: null }), ctx(row.id));
  expect(reopened.status).toBe(200);
  expect((await reopened.json()).data).toMatchObject({ cancelledAt: null, returnDate: null, reason: null, startDate: startUtc });
  expect((await PATCH(item(row.id, { startDate: '2026-10-26T00:00:00Z' }), ctx(row.id))).status).toBe(422);
  expect((await prisma.leaveOfAbsence.findUniqueOrThrow({ where: { id: row.id } })).startDate.toISOString()).toBe(startUtc);
});

test('invalid calendar dates, missing offsets and reverse intervals never change LOA data', async () => {
  const before = await prisma.leaveOfAbsence.count({ where: { userId: ownerId } });
  for (const body of [
    {}, { startDate: '2026-10-25' }, { startDate: '2026-10-25T02:30:00' },
    { startDate: '2026-02-30T00:00:00Z' }, { startDate, returnDate: '2026-10-24T00:00:00Z' },
    { startDate, reason: 12 }, { startDate, userId: otherId },
  ]) expect((await POST(collection('me', 'POST', body), ctx('me'))).status).toBe(422);
  expect(await prisma.leaveOfAbsence.count({ where: { userId: ownerId } })).toBe(before);
  const row = await fixture();
  for (const body of [{ returnDate: '2026-10-24T00:00:00Z' }, { returnDate: '2026-11-02T00:00:00' }, { cancel: 'true' }]) {
    expect((await PATCH(item(row.id, body), ctx(row.id))).status).toBe(422);
  }
  expect(await prisma.leaveOfAbsence.findUniqueOrThrow({ where: { id: row.id } })).toEqual(row);
});

test('LOA reads and mutations enforce ownership and refreshed user hierarchy permissions', async () => {
  const otherRow = await fixture(otherId);
  expect((await GET(collection(otherId), ctx(otherId))).status).toBe(403);
  expect((await POST(collection(otherId, 'POST', { startDate }), ctx(otherId))).status).toBe(403);
  expect((await PATCH(item(otherRow.id, { cancel: true }), ctx(otherRow.id))).status).toBe(403);
  session.userId = managerId;
  const read = await GET(collection(otherId), ctx(otherId));
  expect(read.status).toBe(200);
  expect(await prisma.apiAuditLog.findFirstOrThrow({ where: { correlationId: read.headers.get('X-Request-Id')! } })).toMatchObject({ action: 'user_data.read', actorUserId: managerId, targetUserIds: [otherId], before: null, after: null });
  expect((await POST(collection(otherId, 'POST', { startDate }), ctx(otherId))).status).toBe(201);
  expect((await PATCH(item(otherRow.id, { cancel: true }), ctx(otherRow.id))).status).toBe(200);
  expect((await GET(collection(peerId), ctx(peerId))).status).toBe(403);
  await prisma.userPermission.update({ where: { userId_permissionId: { userId: managerId, permissionId } }, data: { value: 0 } });
  try { expect((await GET(collection(otherId), ctx(otherId))).status).toBe(403); }
  finally { await prisma.userPermission.update({ where: { userId_permissionId: { userId: managerId, permissionId } }, data: { value: 10 } }); }
});

test('LOA pagination is scoped to its target user and audits empty other-user reads without personal payloads', async () => {
  const target = await prisma.user.create({ data: { username: 'LOA pagination target' } });
  session.userId = managerId;
  const empty = await GET(collection(target.id), ctx(target.id));
  expect((await empty.json()).data).toEqual([]);
  expect(await prisma.apiAuditLog.findFirstOrThrow({ where: { correlationId: empty.headers.get('X-Request-Id')! } })).toMatchObject({ action: 'user_data.read', targetUserIds: [target.id], before: null, after: null });
  const first = await fixture(target.id);
  const second = await fixture(target.id);
  await fixture(ownerId);
  const page = await (await GET(collection(target.id, 'GET', undefined, undefined, '?limit=1'), ctx(target.id))).json();
  expect(page.data.map((row: { id: number }) => row.id)).toEqual([second.id]);
  expect(page.meta.nextCursor).toBe(String(second.id));
  const next = await (await GET(collection(target.id, 'GET', undefined, undefined, `?limit=1&cursor=${second.id}`), ctx(target.id))).json();
  expect(next.data.map((row: { id: number }) => row.id)).toEqual([first.id]);
  expect(next.meta.nextCursor).toBeNull();
});

test('bots can manage numeric user LOAs but cannot use me or fall back to valid sessions with invalid credentials', async () => {
  const bot = await prisma.botToken.create({ data: { name: 'LOA integration bot', token: 'loa-integration-token' } });
  session.userId = null;
  expect((await GET(collection('me'), ctx('me'))).status).toBe(401);
  expect((await GET(collection('me', 'GET', undefined, bot.token), ctx('me'))).status).toBe(400);
  expect((await POST(collection('me', 'POST', { startDate }, bot.token), ctx('me'))).status).toBe(400);
  const created = await POST(collection(ownerId, 'POST', { startDate }, bot.token), ctx(ownerId));
  expect(created.status).toBe(201);
  const id = (await created.json()).data.id;
  expect((await PATCH(item(id, { cancel: true }, bot.token), ctx(id))).status).toBe(200);
  const read = await GET(collection(ownerId, 'GET', undefined, bot.token), ctx(ownerId));
  expect(read.status).toBe(200);
  expect(await prisma.apiAuditLog.findFirstOrThrow({ where: { correlationId: read.headers.get('X-Request-Id')! } })).toMatchObject({ actorType: 'bot', actorTokenId: bot.id, targetUserIds: [ownerId], before: null, after: null });
  await prisma.botToken.update({ where: { id: bot.id }, data: { isActive: false } });
  session.userId = ownerId;
  for (const token of [bot.token, 'invalid-loa-token']) {
    expect((await GET(collection('me', 'GET', undefined, token), ctx('me'))).status).toBe(401);
    expect((await POST(collection('me', 'POST', { startDate }, token), ctx('me'))).status).toBe(401);
    expect((await PATCH(item(id, { cancel: false }, token), ctx(id))).status).toBe(401);
  }
});

test('LOA create and update roll back real data changes when transactional audit persistence fails', async () => {
  const row = await fixture();
  const beforeCount = await prisma.leaveOfAbsence.count({ where: { userId: ownerId } });
  const transact = prisma.$transaction.bind(prisma);
  const transactionSpy = vi.spyOn(prisma, '$transaction').mockImplementation(((operation: (tx: Prisma.TransactionClient) => Promise<unknown>) => transact(async tx => {
    const auditSpy = vi.spyOn(tx.apiAuditLog, 'create').mockRejectedValue(new Error('Audit storage unavailable'));
    try { return await operation(tx); } finally { auditSpy.mockRestore(); }
  })) as typeof prisma.$transaction);
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    expect((await POST(collection('me', 'POST', { startDate, reason: 'Rollback LOA create' }), ctx('me'))).status).toBe(500);
    expect((await PATCH(item(row.id, { reason: 'Rollback LOA update', cancel: true }), ctx(row.id))).status).toBe(500);
  } finally { transactionSpy.mockRestore(); log.mockRestore(); }
  expect(await prisma.leaveOfAbsence.count({ where: { userId: ownerId } })).toBe(beforeCount);
  expect(await prisma.leaveOfAbsence.findUniqueOrThrow({ where: { id: row.id } })).toEqual(row);
});
