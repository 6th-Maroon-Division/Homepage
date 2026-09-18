import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import type { Prisma } from '@/generated/prisma/client';
const session = vi.hoisted(() => ({ id: null as number | null }));
vi.mock('next-auth', () => ({ getServerSession: async () => session.id === null ? null : { user: { id: session.id } } }));
vi.mock('@/app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
import { prisma } from '@/lib/prisma';
import { POST as events } from '@/app/api/attendance/events/route';
import { POST as backfill } from '@/app/api/attendance/events/backfill/route';
import { POST as sessions } from '@/app/api/attendance/sessions/route';
import { POST as compile } from '@/app/api/orbats/[id]/attendance/compile/route';
import { processPendingEventsForUser } from '@/lib/pending-events';
let actor: number, member: number, other: number, superior: number, token: string;
const req = (body: unknown, auth?: string) => new Request('http://localhost/api/test', { method: 'POST', headers: auth ? { authorization: auth } : {}, body: JSON.stringify(body) });
const ctx = (id: number) => ({ params: Promise.resolve({ id: String(id) }) });
async function fixture(start = '2020-01-01T10:00:00Z', end = '2020-01-01T12:00:00Z', isSideOp = false) {
  const orbat = await prisma.orbat.create({ data: { name: 'Automation integration operation', createdById: actor, startsAtUtc: new Date(start), endsAtUtc: new Date(end), isSideOp, squads: { create: { name: 'Automation squad', orderIndex: 0 } } }, include: { squads: true } });
  const slot = await prisma.slot.create({ data: { orbatId: orbat.id, squadId: orbat.squads[0].id, orderIndex: 0, maxSignups: 10 } });
  return { orbat, slot };
}
beforeAll(async () => {
  if (!process.env.API_INTEGRATION_DATABASE_URL || process.env.DATABASE_URL !== process.env.API_INTEGRATION_DATABASE_URL) throw new Error('Isolated integration database required');
  const permission = await prisma.permission.upsert({ where: { key: 'attendance:edit' }, create: { key: 'attendance:edit' }, update: {} });
  actor = (await prisma.user.create({ data: { username: 'Automation actor', userPermissions: { create: { permissionId: permission.id, value: 2 } } } })).id;
  member = (await prisma.user.create({ data: { username: 'Automation member' } })).id;
  other = (await prisma.user.create({ data: { username: 'Automation other' } })).id;
  superior = (await prisma.user.create({ data: { username: 'Automation superior', userPermissions: { create: { permissionId: permission.id, value: 3 } } } })).id;
  token = (await prisma.botToken.create({ data: { name: 'Automation token', token: 'attendance-automation-integration-token' } })).token;
});
beforeEach(() => { session.id = actor; });
afterAll(async () => { await prisma.$disconnect(); });
test('raw events enforce live grants and strict UTC, scope duplicates and keep unmatched identities pending', async () => {
  const input = { identity: { provider: 'steam', providerUserId: '76561198000001000' }, isJoin: true, eventTime: '2020-01-01T12:00:00+02:00' };
  const first = await events(req(input)); expect(first.status).toBe(201); const firstBody = await first.json(); expect(firstBody.data).toMatchObject({ userId: null, processed: false, eventTime: '2020-01-01T10:00:00.000Z' });
  const repeat = await events(req(input)); expect(repeat.status).toBe(200); expect((await repeat.json()).meta.duplicate).toBe(true);
  expect((await events(req({ ...input, identity: { provider: 'steam', providerUserId: '76561198000001001' } }))).status).toBe(201);
  expect((await events(req({ userId: superior, isJoin: true, eventTime: input.eventTime }))).status).toBe(403);
  expect((await events(req({ userId: superior, isJoin: true, eventTime: input.eventTime }, `Bearer ${token}`))).status).toBe(201);
  expect((await events(req(input, 'Bearer invalid'))).status).toBe(401);
  const audit = await prisma.apiAuditLog.findFirstOrThrow({ where: { correlationId: first.headers.get('X-Request-Id')! } }); expect(JSON.stringify(audit)).not.toContain(input.identity.providerUserId);
});
test('backfill links bounded pending events and shared account-link helper never matches unrelated missing-provider branches', async () => {
  const a = await prisma.attendanceEvent.create({ data: { steamId: '76561198000002000', isJoin: true, eventTime: new Date('2021-01-01T10:00:00Z') } });
  const b = await prisma.attendanceEvent.create({ data: { steamId: '76561198000002001', isJoin: true, eventTime: new Date('2021-01-01T10:00:00Z') } });
  await prisma.authAccount.create({ data: { userId: member, provider: 'steam', providerUserId: '76561198000002000' } });
  const response = await backfill(req({ cursor: a.id - 1, limit: 1 })); expect(response.status).toBe(200); expect(await response.json()).toEqual({ data: { scannedCount: 1, linkedCount: 1 }, meta: { limit: 1, nextCursor: String(a.id) } });
  expect((await prisma.attendanceEvent.findUniqueOrThrow({ where: { id: a.id } })).userId).toBe(member);
  await processPendingEventsForUser('76561198000002001', null, other);
  expect((await prisma.attendanceEvent.findUniqueOrThrow({ where: { id: b.id } })).userId).toBe(other);
  const unrelated = await prisma.attendanceEvent.findFirstOrThrow({ where: { steamId: '76561198000001001' } }); expect(unrelated.userId).toBeNull(); expect(unrelated.processed).toBe(false);
});
test('raw compiler retains clamping, no-show and start-only behavior with note flags and atomic per-user audits', async () => {
  const { orbat, slot } = await fixture('2030-01-01T10:00:00Z', '2030-01-01T12:00:00Z');
  await prisma.signup.createMany({ data: [{ slotId: slot.id, userId: member }, { slotId: slot.id, userId: other }] });
  await prisma.attendanceEvent.create({ data: { userId: member, isJoin: true, eventTime: new Date('2030-01-01T11:00:00Z'), processed: true } });
  await prisma.orbatAttendanceNote.create({ data: { orbatId: orbat.id, userId: other, status: 'absent' } });
  const response = await compile(req({}), ctx(orbat.id)); expect(response.status).toBe(200); const body = await response.json();
  expect(body.data.attendance).toEqual(expect.arrayContaining([expect.objectContaining({ userId: member, status: 'present', totalMinutesPresent: 120 }), expect.objectContaining({ userId: other, status: 'no_show', notedAbsent: true })]));
  expect(await prisma.apiAuditLog.count({ where: { correlationId: response.headers.get('X-Request-Id')! } })).toBe(2);
  expect((await compile(req({}), ctx(orbat.id))).status).toBe(200); expect(await prisma.attendance.count({ where: { orbatId: orbat.id } })).toBe(2);
});
test('session attached mode and repeated sessions crossing midnight recalculate the full operation without losing earlier segments', async () => {
  const { orbat } = await fixture('2040-01-01T22:00:00Z', '2040-01-02T02:00:00Z');
  const first = await sessions(req({ userId: member, orbatId: orbat.id, checkinTime: '2040-01-01T22:00:00Z', checkoutTime: '2040-01-02T00:00:00Z' })); expect(first.status).toBe(200); expect((await first.json()).data.attendance[0].totalMinutesPresent).toBe(120);
  const second = await sessions(req({ userId: member, orbatId: orbat.id, checkinTime: '2040-01-02T00:15:00Z', checkoutTime: '2040-01-02T02:00:00Z' })); expect(second.status).toBe(200); const body = await second.json(); expect(body.data.attendance[0].totalMinutesPresent).toBe(225); expect(body.data.session.sessionDate).toBe('2040-01-02T00:00:00.000Z');
  expect(await prisma.attendanceSession.count({ where: { attendanceId: body.data.session.attendanceId } })).toBe(2);
});
test('unattached sessions apply overlap/grace-window calculations to signed-up main operations and exclude side operations', async () => {
  const main = await fixture('2050-01-01T10:00:00Z', '2050-01-01T12:00:00Z'); const side = await fixture('2050-01-01T10:00:00Z', '2050-01-01T12:00:00Z', true);
  await prisma.signup.createMany({ data: [{ slotId: main.slot.id, userId: other }, { slotId: side.slot.id, userId: other }] });
  const response = await sessions(req({ userId: other, checkinTime: '2050-01-01T12:15:00+02:00', checkoutTime: '2050-01-01T13:45:00+02:00' })); expect(response.status).toBe(200); const body = await response.json(); expect(body.data.session.attendanceId).toBeNull(); expect(body.data.attendance).toEqual([expect.objectContaining({ totalMinutesPresent: 90, totalMinutesMissed: 0, status: 'present' })]);
  expect(await prisma.attendance.count({ where: { orbatId: side.orbat.id } })).toBe(0);
});
test('invalid session sequencing, sideops, hierarchy and all-target compile preflight roll back', async () => {
  expect((await sessions(req({ userId: actor, checkoutTime: '2060-01-01T12:00:00Z' }))).status).toBe(409);
  expect((await sessions(req({ userId: actor, checkinTime: '2060-01-01T10:00:00Z' }))).status).toBe(200);
  expect((await sessions(req({ userId: actor, checkinTime: '2060-01-01T11:00:00Z' }))).status).toBe(409);
  expect((await sessions(req({ userId: actor, checkoutTime: '2060-01-01T09:00:00Z' }))).status).toBe(422);
  const { orbat, slot } = await fixture('2061-01-01T10:00:00Z', '2061-01-01T12:00:00Z'); await prisma.signup.createMany({ data: [{ userId: member, slotId: slot.id }, { userId: superior, slotId: slot.id }] });
  expect((await compile(req({}), ctx(orbat.id))).status).toBe(403); expect(await prisma.attendance.count({ where: { orbatId: orbat.id } })).toBe(0);
});
test('real audit failure rolls back raw events, sessions and compiled records/logs', async () => {
  const { orbat, slot } = await fixture('2070-01-01T10:00:00Z', '2070-01-01T12:00:00Z'); await prisma.signup.create({ data: { slotId: slot.id, userId: member } });
  const transaction = prisma.$transaction.bind(prisma); const spy = vi.spyOn(prisma, '$transaction').mockImplementation(((callback: (tx: Prisma.TransactionClient) => unknown, options: unknown) => transaction(async tx => { const original = tx.apiAuditLog.create; tx.apiAuditLog.create = (() => { throw new Error('Injected audit failure'); }) as typeof original; try { return await callback(tx); } finally { tx.apiAuditLog.create = original; } }, options as never)) as typeof prisma.$transaction); const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    expect((await events(req({ userId: other, isJoin: false, eventTime: '2070-01-01T11:00:00Z' }))).status).toBe(500);
    expect((await sessions(req({ userId: member, orbatId: orbat.id, checkinTime: '2070-01-01T10:00:00Z' }))).status).toBe(500);
    expect((await compile(req({}), ctx(orbat.id))).status).toBe(500);
  } finally { spy.mockRestore(); log.mockRestore(); }
  expect(await prisma.attendance.count({ where: { orbatId: orbat.id } })).toBe(0); expect(await prisma.attendanceEvent.count({ where: { eventTime: new Date('2070-01-01T11:00:00Z'), userId: other } })).toBe(0);
});
