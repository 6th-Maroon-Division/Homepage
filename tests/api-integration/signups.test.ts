import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import type { Prisma } from '@/generated/prisma/client';
const session = vi.hoisted(() => ({ id: null as number | null }));
vi.mock('next-auth', () => ({ getServerSession: async () => session.id === null ? null : { user: { id: session.id } } }));
vi.mock('@/app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
import { prisma } from '@/lib/prisma';
import { POST } from '@/app/api/signups/route';
import { PATCH, DELETE } from '@/app/api/signups/[id]/route';
import { GET as list } from '@/app/api/orbats/[id]/signups/route';
import { GET as userList } from '@/app/api/users/[id]/signups/route';
import { GET as eligibility } from '@/app/api/orbats/[id]/eligibility/route';
import { GET as available } from '@/app/api/orbats/[id]/available-slots/route';
import { GET as noteGet, PATCH as notePatch, DELETE as noteDelete } from '@/app/api/orbats/[id]/availability/[userId]/route';
let actor: number, member: number, other: number, superior: number, token: string, grantId: number;
const req = (method: string, body?: unknown, query = '', headers: Record<string, string> = {}) => new Request(`http://localhost/api/test${query}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const ctx = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) });
const noteCtx = (id: number, userId: number | string = 'me') => ({ params: Promise.resolve({ id: String(id), userId: String(userId) }) });
const bot = () => ({ authorization: `Bearer ${token}` });
async function fixture(isSideOp = false, roleId?: number) {
  const orbat = await prisma.orbat.create({ data: { name: 'Signup integration operation', createdById: actor, startsAtUtc: new Date('2099-01-01T00:00:00Z'), isSideOp, squads: { create: { name: 'Signup squad', orderIndex: 0 } } }, include: { squads: true } });
  const slots = [];
  for (let index = 0; index < 3; index++) slots.push(await prisma.slot.create({ data: { orbatId: orbat.id, squadId: orbat.squads[0].id, orderIndex: index, maxSignups: index === 0 ? 1 : 2, squadRoleId: roleId } }));
  return { orbat, slots };
}
beforeAll(async () => {
  if (!process.env.API_INTEGRATION_DATABASE_URL || process.env.DATABASE_URL !== process.env.API_INTEGRATION_DATABASE_URL) throw new Error('Isolated integration database required');
  grantId = (await prisma.permission.upsert({ where: { key: 'orbat:edit' }, create: { key: 'orbat:edit' }, update: {} })).id;
  actor = (await prisma.user.create({ data: { username: 'Signup integration actor', userPermissions: { create: { permissionId: grantId, value: 2 } } } })).id;
  member = (await prisma.user.create({ data: { username: 'Signup integration member' } })).id;
  other = (await prisma.user.create({ data: { username: 'Signup integration other' } })).id;
  superior = (await prisma.user.create({ data: { username: 'Signup integration superior', userPermissions: { create: { permissionId: grantId, value: 3 } } } })).id;
  token = (await prisma.botToken.create({ data: { name: 'Signup integration bot', token: 'signup-integration-token' } })).token;
});
beforeEach(() => { session.id = member; });
afterAll(async () => { await prisma.$disconnect(); });
test('self signup, staff move and self delete share DTO/history/outbox while keeping attendance on move', async () => {
  const { orbat, slots } = await fixture();
  const created = await POST(req('POST', { slotId: slots[0].id })); expect(created.status).toBe(201);
  const { data } = await created.json(); expect(data).toMatchObject({ userId: member, slotId: slots[0].id, orbatId: orbat.id }); expect(data.createdAt).toMatch(/Z$/);
  const attendance = await prisma.attendance.create({ data: { userId: member, orbatId: orbat.id, signupId: data.id, notes: 'Sensitive attendance note' } });
  session.id = actor;
  expect((await PATCH(req('PATCH', { slotId: slots[1].id }), ctx(data.id))).status).toBe(200);
  expect((await prisma.attendance.findUniqueOrThrow({ where: { id: attendance.id } })).signupId).toBe(data.id);
  session.id = member;
  const removed = await DELETE(req('DELETE'), ctx(data.id)); expect((await removed.json()).data).toBeNull();
  expect(await prisma.attendance.findUnique({ where: { id: attendance.id } })).toBeNull();
  const audit = await prisma.apiAuditLog.findFirstOrThrow({ where: { correlationId: removed.headers.get('X-Request-Id')! } });
  expect(audit.targetUserIds).toEqual([member]); expect(audit.before).toMatchObject({ attendanceId: attendance.id }); expect(JSON.stringify(audit)).not.toContain('Sensitive attendance note');
  expect(await prisma.botEvent.count({ where: { aggregateId: String(orbat.id), type: 'orbat.signup_changed' } })).toBe(3);
});
test('real serialized concurrent requests cannot overfill slots or give a user two operation signups', async () => {
  const { slots } = await fixture(); session.id = null;
  const responses = await Promise.all([POST(req('POST', { slotId: slots[0].id, userId: member }, '', bot())), POST(req('POST', { slotId: slots[0].id, userId: other }, '', bot()))]);
  expect(responses.map(row => row.status).sort()).toEqual([201, 409]); expect(await prisma.signup.count({ where: { slotId: slots[0].id } })).toBe(1);
  const next = await fixture();
  const duplicates = await Promise.all([POST(req('POST', { slotId: next.slots[0].id, userId: member }, '', bot())), POST(req('POST', { slotId: next.slots[1].id, userId: member }, '', bot()))]);
  expect(duplicates.map(row => row.status).sort()).toEqual([201, 409]); expect(await prisma.signup.count({ where: { userId: member, slot: { orbatId: next.orbat.id } } })).toBe(1);
});
test('live hierarchy and user/bot credential validity applies to all targeted actions and lists', async () => {
  const { slots, orbat } = await fixture(); session.id = actor;
  expect((await POST(req('POST', { slotId: slots[0].id, userId: superior }))).status).toBe(403);
  expect((await userList(req('GET'), ctx(superior))).status).toBe(403);
  expect((await notePatch(req('PATCH', { status: 'unsure' }), noteCtx(orbat.id, superior))).status).toBe(403);
  expect((await POST(req('POST', { slotId: slots[0].id, userId: superior }, '', bot()))).status).toBe(201);
  expect((await POST(req('POST', { slotId: slots[1].id }, '', bot()))).status).toBe(400);
  expect((await POST(req('POST', { slotId: slots[1].id }, '', { authorization: 'Bearer invalid' }))).status).toBe(401);
  session.id = member; expect((await list(req('GET'), ctx(orbat.id))).status).toBe(403);
  expect((await PATCH(req('PATCH', { slotId: slots[1].id }), ctx(2147483647))).status).toBe(403);
});
test('rank and qualification rules block signup, needs_qualify permits temporary access, sideops bypass only requirements', async () => {
  const rank = await prisma.rank.create({ data: { name: 'Signup integration rank', abbreviation: 'SIR', orderIndex: 2 } });
  const training = await prisma.training.create({ data: { name: 'Signup integration training', requiresOrbatQualification: true } });
  const role = await prisma.squadRole.create({ data: { name: 'Signup integration role', requiredRankIds: [rank.id], requiredTrainingIds: [training.id] } });
  const { slots, orbat } = await fixture(false, role.id);
  let response = await POST(req('POST', { slotId: slots[0].id })); expect((await response.json()).error.code).toBe('rank_required');
  await prisma.userRank.upsert({ where: { userId: member }, create: { userId: member, currentRankId: rank.id }, update: { currentRankId: rank.id } });
  response = await POST(req('POST', { slotId: slots[0].id })); expect((await response.json()).error.code).toBe('training_required');
  await prisma.userTraining.create({ data: { userId: member, trainingId: training.id, status: 'needs_qualify' } });
  const eligible = await eligibility(req('GET', undefined, '?limit=1'), ctx(orbat.id)); expect((await eligible.json()).data[0]).toMatchObject({ allowed: true, temporary: true, temporaryTrainings: [{ id: training.id, name: training.name }] });
  expect((await POST(req('POST', { slotId: slots[0].id }))).status).toBe(201);
  const side = await fixture(true, role.id); session.id = other;
  expect((await POST(req('POST', { slotId: side.slots[0].id }))).status).toBe(201);
  const absent = await fixture(true, role.id); await prisma.orbatAttendanceNote.create({ data: { orbatId: absent.orbat.id, userId: other, status: 'absent' } });
  response = await POST(req('POST', { slotId: absent.slots[0].id })); expect((await response.json()).error.code).toBe('marked_absent');
});
test('explicit staff override preserves warnings but cannot move between operations', async () => {
  const training = await prisma.training.create({ data: { name: 'Signup override requirement' } });
  const role = await prisma.squadRole.create({ data: { name: 'Signup override role', requiredTrainingIds: [training.id] } });
  const { orbat, slots } = await fixture(); const constrained = await prisma.slot.create({ data: { orbatId: orbat.id, squadId: slots[0].squadId, orderIndex: 3, squadRoleId: role.id } });
  const created = (await (await POST(req('POST', { slotId: slots[0].id }))).json()).data;
  session.id = actor;
  expect((await PATCH(req('PATCH', { slotId: constrained.id }), ctx(created.id))).status).toBe(409);
  const moved = await PATCH(req('PATCH', { slotId: constrained.id, overrideRequirements: true }), ctx(created.id)); expect(moved.status).toBe(200); expect((await moved.json()).meta.warnings).toHaveLength(1);
  const otherOperation = await fixture(); expect((await PATCH(req('PATCH', { slotId: otherOperation.slots[0].id, overrideRequirements: true }), ctx(created.id))).status).toBe(409);
});
test('actor-scoped idempotent retries do not duplicate writes, enforce request hash, and survive delete', async () => {
  const { slots } = await fixture(); const headers = { 'idempotency-key': 'signup-create-retry' };
  const first = await POST(req('POST', { slotId: slots[0].id }, '', headers)); const firstBody = await first.json();
  const second = await POST(req('POST', { slotId: slots[0].id }, '', headers)); expect(second.status).toBe(201); expect(await second.json()).toEqual(firstBody);
  expect((await POST(req('POST', { slotId: slots[1].id }, '', headers))).status).toBe(409);
  expect(await prisma.signup.count({ where: { slotId: slots[0].id } })).toBe(1);
  const deleted = await DELETE(req('DELETE', undefined, '', { 'idempotency-key': 'signup-delete-retry' }), ctx(firstBody.data.id)); expect(deleted.status).toBe(200);
  expect((await DELETE(req('DELETE', undefined, '', { 'idempotency-key': 'signup-delete-retry' }), ctx(firstBody.data.id))).status).toBe(200);
});
test('public counts and protected lists use real cursor boundaries and targeted read audits', async () => {
  const { slots, orbat } = await fixture();
  await POST(req('POST', { slotId: slots[0].id })); session.id = other; await POST(req('POST', { slotId: slots[1].id }));
  session.id = null; const counts = await available(req('GET', undefined, '?limit=2'), ctx(orbat.id)); const body = await counts.json();
  expect(body.data).toHaveLength(2); expect(body.meta.nextCursor).toBe(String(slots[1].id)); expect(body.data[0]).not.toHaveProperty('userId');
  const final = await available(req('GET', undefined, `?limit=2&cursor=${body.meta.nextCursor}`), ctx(orbat.id)); expect((await final.json()).meta.nextCursor).toBeNull();
  session.id = actor; const page = await list(req('GET', undefined, '?limit=1'), ctx(orbat.id)); const listBody = await page.json();
  expect(listBody.data).toHaveLength(1); expect(listBody.data[0].user).toEqual({ id: other, username: 'Signup integration other' });
  const audit = await prisma.apiAuditLog.findFirstOrThrow({ where: { correlationId: page.headers.get('X-Request-Id')! } }); expect(audit.targetUserIds).toEqual([other]);
});
test('availability uses shared state, UTC DTO and redacted audit; absence blocks signup until removal', async () => {
  const { orbat, slots } = await fixture();
  const response = await notePatch(req('PATCH', { status: 'absent', reason: 'Private absence details' }), noteCtx(orbat.id)); expect(response.status).toBe(200);
  expect((await response.json()).data.createdAt).toMatch(/Z$/);
  const audit = await prisma.apiAuditLog.findFirstOrThrow({ where: { correlationId: response.headers.get('X-Request-Id')! } }); expect(JSON.stringify(audit)).not.toContain('Private absence details');
  expect((await POST(req('POST', { slotId: slots[0].id }))).status).toBe(409);
  session.id = actor; const read = await noteGet(req('GET'), noteCtx(orbat.id, member)); expect(read.status).toBe(200); expect((await prisma.apiAuditLog.findFirstOrThrow({ where: { correlationId: read.headers.get('X-Request-Id')! } })).targetUserIds).toEqual([member]);
  session.id = member; expect((await noteDelete(req('DELETE'), noteCtx(orbat.id))).status).toBe(200); expect((await POST(req('POST', { slotId: slots[0].id }))).status).toBe(201);
});
test('real transactions roll back signup/note/outbox/idempotency when audit fails and read audit fails closed', async () => {
  const { slots, orbat } = await fixture();
  const transaction = prisma.$transaction.bind(prisma);
  const spy = vi.spyOn(prisma, '$transaction').mockImplementation(((callback: (tx: Prisma.TransactionClient) => unknown, options: unknown) => transaction(async tx => {
    const original = tx.apiAuditLog.create; tx.apiAuditLog.create = (() => { throw new Error('Injected audit failure'); }) as typeof original;
    try { return await callback(tx); } finally { tx.apiAuditLog.create = original; }
  }, options as never)) as typeof prisma.$transaction);
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    expect((await POST(req('POST', { slotId: slots[0].id }, '', { 'idempotency-key': 'must-rollback' }))).status).toBe(500);
    expect((await notePatch(req('PATCH', { status: 'unsure' }), noteCtx(orbat.id))).status).toBe(500);
    session.id = actor; expect((await noteGet(req('GET'), noteCtx(orbat.id, member))).status).toBe(500);
  } finally { spy.mockRestore(); log.mockRestore(); }
  expect(await prisma.signup.count({ where: { slot: { orbatId: orbat.id } } })).toBe(0); expect(await prisma.orbatAttendanceNote.count({ where: { orbatId: orbat.id } })).toBe(0); expect(await prisma.botEvent.count({ where: { aggregateId: String(orbat.id) } })).toBe(0);
});
