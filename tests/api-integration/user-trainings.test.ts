import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
const state = vi.hoisted(() => ({ userId: null as number | null }));
vi.mock('next-auth', () => ({ getServerSession: async () => state.userId === null ? null : { user: { id: String(state.userId) } } }));
vi.mock('@/app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
vi.mock('@/lib/realtime/training-chat-events', () => ({ publishTrainingChatEvent: vi.fn() }));
vi.mock('@/lib/realtime/user-events', () => ({ publishUserProfileEvent: vi.fn() }));
vi.mock('@/lib/realtime/inbox-events', () => ({ publishInboxEvents: vi.fn() }));
vi.mock('@/lib/realtime/orbat-events', () => ({ publishOrbatEvent: vi.fn() }));
import { prisma } from '@/lib/prisma';
import { GET as list, POST as create, PATCH as bulk } from '@/app/api/user-trainings/route';
import { PATCH as update, DELETE as remove } from '@/app/api/user-trainings/[id]/route';
import { GET as qualifications } from '@/app/api/orbats/[id]/qualifications/route';
import { POST as signup } from '@/app/api/signups/route';
import { PATCH as move } from '@/app/api/signups/[id]/route';
let staff: number, member: number, other: number, higher: number; let counter = 0;
const ctx = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) });
const req = (method = 'GET', body?: unknown, query = '', token?: string) => new Request(`http://localhost/api/user-trainings${query}`, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
async function training(orbat = false) { return prisma.training.create({ data: { name: `Credential test ${++counter}`, requiresTrainingSession: false, requiresOrbatQualification: orbat } }); }
async function granted(orbat = false, userId = member) { const item = await training(orbat); const response = await create(req('POST', { userId, trainingId: item.id, status: orbat ? 'needs_qualify' : 'qualified', notes: 'Private credential note' })); expect(response.status).toBe(201); return { item, row: (await response.json()).data }; }
async function operation(trainingId: number) {
  const role = await prisma.squadRole.create({ data: { name: `Qualification ${++counter}`, requiredTrainingIds: [trainingId] } });
  const orbat = await prisma.orbat.create({ data: { name: 'Qualification operation', createdById: staff, startsAtUtc: new Date(Date.now() + 86400000), squads: { create: { name: 'Team', orderIndex: 0 } } }, include: { squads: true } });
  const slot = await prisma.slot.create({ data: { orbatId: orbat.id, squadId: orbat.squads[0].id, squadRoleId: role.id, orderIndex: 0, maxSignups: 2 } });
  return { orbat, slot, role };
}
beforeAll(async () => {
 if (!process.env.API_INTEGRATION_DATABASE_URL || process.env.DATABASE_URL !== process.env.API_INTEGRATION_DATABASE_URL) throw new Error('Isolated integration database required.');
 const permission = await prisma.permission.upsert({ where: { key: 'training:mark' }, create: { key: 'training:mark' }, update: {} });
 staff = (await prisma.user.create({ data: { username: 'Credential staff', userPermissions: { create: { permissionId: permission.id, value: 1 } } } })).id;
 higher = (await prisma.user.create({ data: { username: 'Higher credential staff', userPermissions: { create: { permissionId: permission.id, value: 2 } } } })).id;
 member = (await prisma.user.create({ data: { username: 'Credential member' } })).id; other = (await prisma.user.create({ data: { username: 'Credential other' } })).id;
});
beforeEach(() => { state.userId = staff; });
afterAll(async () => { await prisma.$disconnect(); });
test('credential mutation preserves workflow, request status/history/inbox and redacts audits', async () => {
 const item = await training(true); const request = await prisma.trainingRequest.create({ data: { userId: member, trainingId: item.id, status: 'approved' } });
 const created = await create(req('POST', { userId: member, trainingId: item.id, status: 'needs_qualify', notes: 'Sensitive credential text' })); expect(created.status).toBe(201); const row = (await created.json()).data;
 expect(await prisma.userTrainingStatusHistory.count({ where: { userTrainingId: row.id } })).toBe(1); expect((await prisma.trainingRequest.findUniqueOrThrow({ where: { id: request.id } })).status).toBe('needs_qualify');
 const audit = await prisma.apiAuditLog.findFirstOrThrow({ where: { correlationId: created.headers.get('X-Request-Id')! } }); expect(JSON.stringify(audit)).not.toContain('Sensitive credential text');
 const updated = await update(req('PATCH', { status: 'qualified' }), ctx(row.id)); expect(updated.status).toBe(200); expect((await updated.json()).data.orbatQualifiedAt).toMatch(/Z$/);
 expect(await prisma.userTrainingStatusHistory.count({ where: { userTrainingId: row.id } })).toBe(2); expect(await prisma.message.count({ where: { title: { startsWith: item.name } } })).toBe(2);
 expect((await update(req('PATCH', { status: 'approved' }), ctx(row.id))).status).toBe(409);
 expect((await remove(req('DELETE'), ctx(row.id))).status).toBe(200); expect(await prisma.userTrainingStatusHistory.count({ where: { userTrainingId: row.id } })).toBe(0);
});
test('member list filters before paging, hides marked records and staff history identities', async () => {
 const { item, row } = await granted(); await update(req('PATCH', { isHidden: true }), ctx(row.id)); const visible = await granted(); state.userId = member;
 expect((await (await list(req('GET', undefined, `?trainingId=${item.id}`))).json()).data).toEqual([]);
 const page = (await (await list(req('GET', undefined, `?trainingId=${visible.item.id}&limit=1`))).json()); const data = await page; expect(data.meta.nextCursor).toBeNull(); expect(data.data[0].statusHistory[0].changedBy).toBeNull();
 expect((await list(req('GET', undefined, `?userId=${other}`))).status).toBe(403);
 expect((await update(req('PATCH', { notes: 'unauthorized' }), ctx(visible.row.id))).status).toBe(403);
});
test('bulk upsert is atomic across permissions and validation and retains transition history', async () => {
 const item = await training(true); const body = { updates: [{ userId: member, trainingId: item.id, status: 'needs_qualify' }, { userId: higher, trainingId: item.id, status: 'needs_qualify' }] };
 expect((await bulk(req('PATCH', body))).status).toBe(403); expect(await prisma.userTraining.count({ where: { trainingId: item.id } })).toBe(0);
 body.updates[1].userId = other; const result = await bulk(req('PATCH', body)); expect(result.status).toBe(200); expect((await result.json()).data.map((row: { userId: number }) => row.userId)).toEqual([member, other]);
 expect((await bulk(req('PATCH', { updates: [body.updates[0],body.updates[0]] }))).status).toBe(422);
 expect((await bulk(req('PATCH', body))).status).toBe(200); expect(await prisma.userTrainingStatusHistory.count({ where: { userTraining: { trainingId: item.id } } })).toBe(2);
});
test('qualification signup requires exact role, pending credential, live staff hierarchy and all normal guards', async () => {
 const { item, row } = await granted(true); const { orbat, slot, role } = await operation(item.id);
 const response = await signup(req('POST', { userId: member, slotId: slot.id, qualificationTrainingId: item.id })); expect(response.status).toBe(201); const assigned = (await response.json()).data;
 const panel = await qualifications(req('GET', undefined, '?limit=1'), ctx(orbat.id)); expect(panel.status).toBe(200); expect((await panel.json()).data.groups[0].users[0].existingSignupId).toBe(assigned.id);
 const second = await prisma.slot.create({ data: { orbatId: orbat.id, squadId: slot.squadId, squadRoleId: role.id, orderIndex: 1, maxSignups: 1 } });
 expect((await move(req('PATCH', { slotId: second.id, qualificationTrainingId: item.id }), ctx(assigned.id))).status).toBe(200);
 expect((await move(req('PATCH', { slotId: slot.id, qualificationTrainingId: item.id, overrideRequirements: true }), ctx(assigned.id))).status).toBe(422);
 const decided = await update(req('PATCH', { orbatId: orbat.id, status: 'qualified', notes: 'Good evaluation' }), ctx(row.id)); expect(decided.status).toBe(200);
 expect((await move(req('PATCH', { slotId: slot.id, qualificationTrainingId: item.id }), ctx(assigned.id))).status).toBe(409);
 const history = await prisma.userTrainingStatusHistory.findFirstOrThrow({ where: { userTrainingId: row.id, toStatus: 'qualified' } }); expect(history.orbatId).toBe(orbat.id);
});
test('ORBAT decision cannot use a side operation or an unrelated signup', async () => {
 const { item, row } = await granted(true); const { orbat, slot } = await operation(item.id);
 expect((await update(req('PATCH', { orbatId: orbat.id, status: 'qualified' }), ctx(row.id))).status).toBe(409);
 await prisma.orbat.update({ where: { id: orbat.id }, data: { isSideOp: true } });
 expect((await qualifications(req(), ctx(orbat.id))).status).toBe(409); expect((await signup(req('POST', { userId: member, slotId: slot.id, qualificationTrainingId: item.id }))).status).toBe(409);
});
test('bot credential writes keep nullable attribution and invalid/revoked tokens never fall back', async () => {
 const item = await training(); const token = await prisma.botToken.create({ data: { name: 'Credential bot', token: `credential-${++counter}`, createdById: staff } });
 try {
 const response = await create(req('POST', { userId: member, trainingId: item.id }, '', token.token)); expect(response.status).toBe(201); const row = (await response.json()).data; expect(row.trainerId).toBeNull();
 expect((await list(req('GET', undefined, '?userId=me', token.token))).status).toBe(400);
 await prisma.botToken.update({ where: { id: token.id }, data: { isActive: false } }); expect((await remove(req('DELETE', undefined, '', token.token), ctx(row.id))).status).toBe(401);
 } finally { await prisma.botToken.delete({ where: { id: token.id } }); }
});
test('audit failure rolls back credential, history, inbox and request changes', async () => {
 const item = await training(); const before = await prisma.message.count(); const spy = vi.spyOn(prisma, '$transaction').mockImplementationOnce(async (work: unknown) => prisma.$transaction(async tx => { const original = tx.apiAuditLog.create; tx.apiAuditLog.create = (async () => { throw new Error('audit unavailable'); }) as typeof original; return (work as (tx: typeof prisma) => Promise<unknown>)(tx as typeof prisma); }) as never);
 try { expect((await create(req('POST', { userId: member, trainingId: item.id }))).status).toBe(500); } finally { spy.mockRestore(); }
 expect(await prisma.userTraining.count({ where: { trainingId: item.id } })).toBe(0); expect(await prisma.message.count()).toBe(before);
});
