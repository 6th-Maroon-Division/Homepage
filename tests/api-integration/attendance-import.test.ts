import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import type { Prisma } from '@/generated/prisma/client';
const session = vi.hoisted(() => ({ id: null as number | null }));
vi.mock('next-auth', () => ({ getServerSession: async () => session.id === null ? null : { user: { id: session.id } } }));
vi.mock('@/app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
import { prisma } from '@/lib/prisma';
import { POST } from '@/app/api/orbats/[id]/attendance/import/route';
let actor: number, member: number, superior: number, token: string;
const req = (records: unknown, auth?: string) => new Request('http://localhost/api/test', { method: 'POST', headers: auth ? { authorization: auth } : {}, body: JSON.stringify({ records }) });
const ctx = (id: number) => ({ params: Promise.resolve({ id: String(id) }) });
const row = (username = 'Direct import member', status = 'P') => ({ username, date: '2020-01-01', status });
async function fixture() {
  const orbat = await prisma.orbat.create({ data: { name: 'Direct import operation', createdById: actor, startsAtUtc: new Date('2020-01-02T01:00:00+02:00'), squads: { create: { name: 'Import squad', orderIndex: 0 } } }, include: { squads: true } });
  const slot = await prisma.slot.create({ data: { orbatId: orbat.id, squadId: orbat.squads[0].id, orderIndex: 0, maxSignups: 10 } });
  return { orbat, slot };
}
beforeAll(async () => {
  if (!process.env.API_INTEGRATION_DATABASE_URL || process.env.DATABASE_URL !== process.env.API_INTEGRATION_DATABASE_URL) throw new Error('Isolated integration database required');
  const permission = await prisma.permission.upsert({ where: { key: 'attendance:edit' }, create: { key: 'attendance:edit' }, update: {} });
  actor = (await prisma.user.create({ data: { username: 'Direct import actor', userPermissions: { create: { permissionId: permission.id, value: 2 } } } })).id;
  member = (await prisma.user.create({ data: { username: 'Direct import member' } })).id;
  superior = (await prisma.user.create({ data: { username: 'Direct import superior', userPermissions: { create: { permissionId: permission.id, value: 3 } } } })).id;
  token = (await prisma.botToken.create({ data: { name: 'Direct import token', token: 'direct-import-integration-token' } })).token;
});
beforeEach(() => { session.id = actor; });
afterAll(async () => { await prisma.$disconnect(); });
test('UTC operation date, session actor, status mapping, skipped markers and repeated import conflict', async () => {
  const { orbat, slot } = await fixture(); const signup = await prisma.signup.create({ data: { userId: member, slotId: slot.id } });
  const response = await POST(req([row(), row('Skipped no operation', 'NO'), row('Skipped event', 'EO')]), ctx(orbat.id)); expect(response.status).toBe(200); expect(await response.json()).toEqual({ data: { imported: 1, skipped: 2, total: 3 }, meta: {} });
  const attendance = await prisma.attendance.findFirstOrThrow({ where: { orbatId: orbat.id }, include: { logs: true } }); expect(attendance).toMatchObject({ userId: member, signupId: signup.id, status: 'present', totalMinutesPresent: 0 }); expect(attendance.logs[0]).toMatchObject({ changedById: actor, source: 'legacy_import', action: 'imported' });
  const audit = await prisma.apiAuditLog.findFirstOrThrow({ where: { correlationId: response.headers.get('X-Request-Id')! } }); expect(audit).toMatchObject({ action: 'attendance.imported', resource: 'attendance', targetUserIds: [member] }); expect(JSON.stringify(audit)).not.toContain('Direct import member');
  expect((await POST(req([row()]), ctx(orbat.id))).status).toBe(409); expect(await prisma.attendance.count({ where: { orbatId: orbat.id } })).toBe(1);
});
test('same-date signup in another operation cannot be attached to imported operation', async () => {
  const a = await fixture(), b = await fixture(); await prisma.signup.create({ data: { userId: member, slotId: a.slot.id } });
  expect((await POST(req([row()]), ctx(b.orbat.id))).status).toBe(404); expect(await prisma.attendance.count({ where: { orbatId: b.orbat.id } })).toBe(0);
});
test('later hierarchy failure prevents any writes; bot bypass has truthful actor and revoked token never falls back', async () => {
  const { orbat, slot } = await fixture(); await prisma.signup.createMany({ data: [{ userId: member, slotId: slot.id }, { userId: superior, slotId: slot.id }] }); const rows = [row(), row('Direct import superior', 'LOA')];
  expect((await POST(req(rows), ctx(orbat.id))).status).toBe(403); expect(await prisma.attendance.count({ where: { orbatId: orbat.id } })).toBe(0);
  const response = await POST(req(rows, `Bearer ${token}`), ctx(orbat.id)); expect(response.status).toBe(200); const attendance = await prisma.attendance.findMany({ where: { orbatId: orbat.id }, include: { logs: true }, orderBy: { id: 'asc' } }); expect(attendance.map(value => value.status)).toEqual(['present','absent']); expect(attendance.every(value => value.logs[0].changedById === null)).toBe(true);
  await prisma.botToken.update({ where: { token }, data: { isActive: false } }); expect((await POST(req(rows, `Bearer ${token}`), ctx(orbat.id))).status).toBe(401); await prisma.botToken.update({ where: { token }, data: { isActive: true } });
  session.id = member; expect((await POST(req([row()]), ctx(orbat.id))).status).toBe(403);
});
test('invalid dates, duplicate rows, missing target and side operations cause no writes', async () => {
  const { orbat, slot } = await fixture(); await prisma.signup.create({ data: { userId: member, slotId: slot.id } });
  expect((await POST(req([{ ...row(), date: '2020-01-02' }]), ctx(orbat.id))).status).toBe(422); expect((await POST(req([row(), row()]), ctx(orbat.id))).status).toBe(422); expect((await POST(req([row('Missing direct import')]), ctx(orbat.id))).status).toBe(404);
  await prisma.orbat.update({ where: { id: orbat.id }, data: { isSideOp: true } }); expect((await POST(req([row()]), ctx(orbat.id))).status).toBe(409); expect(await prisma.attendance.count({ where: { orbatId: orbat.id } })).toBe(0);
});
test('second audit failure rolls back both imported rows, logs and first audit', async () => {
  const { orbat, slot } = await fixture(); await prisma.signup.createMany({ data: [{ userId: member, slotId: slot.id }, { userId: actor, slotId: slot.id }] });
  const transaction = prisma.$transaction.bind(prisma); const spy = vi.spyOn(prisma, '$transaction').mockImplementation(((callback: (tx: Prisma.TransactionClient) => unknown, options: unknown) => transaction(async tx => { let count = 0; const original = tx.apiAuditLog.create.bind(tx.apiAuditLog); tx.apiAuditLog.create = ((args: Parameters<typeof original>[0]) => { if (++count === 2) throw new Error('Injected audit failure'); return original(args); }) as unknown as typeof original; try { return await callback(tx); } finally { tx.apiAuditLog.create = original; } }, options as never)) as typeof prisma.$transaction); const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  try { const response = await POST(req([row(), row('Direct import actor', 'NA')]), ctx(orbat.id)); expect(response.status).toBe(500); expect(await prisma.attendance.count({ where: { orbatId: orbat.id } })).toBe(0); expect(await prisma.apiAuditLog.count({ where: { correlationId: response.headers.get('X-Request-Id')! } })).toBe(0); } finally { spy.mockRestore(); log.mockRestore(); }
});
