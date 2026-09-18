import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import type { Prisma } from '@/generated/prisma/client';
const session = vi.hoisted(() => ({ id: null as number | null }));
vi.mock('next-auth', () => ({ getServerSession: async () => session.id === null ? null : { user: { id: session.id } } }));
vi.mock('@/app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
import { prisma } from '@/lib/prisma';
import { GET, PATCH, DELETE } from '@/app/api/orbats/[id]/route';
let actor: number, member: number, role: number, retired: number, radio: number, token: string;
const context = (id: number) => ({ params: Promise.resolve({ id: String(id) }) });
const request = (method: string, body?: unknown, auth?: string) => new Request('http://localhost/api/orbats/20', { method, headers: auth ? { authorization: auth } : {}, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
async function fixture() {
  return prisma.orbat.create({ data: { name: 'Editor integration', description: 'Private operation prose', createdById: actor, startsAtUtc: new Date('2020-01-01T10:00:00Z'), endsAtUtc: new Date('2020-01-01T12:00:00Z'), squads: { create: [{ name: 'A', orderIndex: 0 }, { name: 'B', orderIndex: 1 }] } }, include: { squads: { orderBy: { orderIndex: 'asc' } } } });
}
beforeAll(async () => {
  if (!process.env.API_INTEGRATION_DATABASE_URL || process.env.DATABASE_URL !== process.env.API_INTEGRATION_DATABASE_URL) throw new Error('Isolated integration database required');
  const permissions = await Promise.all(['orbat:edit', 'orbat:delete'].map(key => prisma.permission.upsert({ where: { key }, create: { key }, update: {} })));
  actor = (await prisma.user.create({ data: { username: 'Editor integration actor', userPermissions: { create: permissions.map(permission => ({ permissionId: permission.id, value: 1 })) } } })).id;
  member = (await prisma.user.create({ data: { username: 'Editor integration member' } })).id;
  role = (await prisma.squadRole.create({ data: { name: 'Editor integration role' } })).id;
  retired = (await prisma.squadRole.create({ data: { name: 'Editor integration retired', isRetired: true } })).id;
  radio = (await prisma.radioFrequency.create({ data: { frequency: '328.781', type: 'SR' } })).id;
  token = (await prisma.botToken.create({ data: { name: 'Editor integration bot', token: 'editor-integration-token' } })).token;
});
beforeEach(() => { session.id = actor; });
afterAll(async () => { await prisma.$disconnect(); });
test('GET is protected minimal editor catalog with UTC and frequency IDs, never user identities', async () => {
  const operation = await fixture();
  await prisma.orbatRadioFrequency.create({ data: { orbatId: operation.id, radioFrequencyId: radio } });
  const response = await GET(request('GET'), context(operation.id));
  expect(response.status).toBe(200); const { data } = await response.json();
  expect(data.startsAtUtc).toBe('2020-01-01T10:00:00.000Z'); expect(data.frequencyIds).toEqual([radio]);
  expect(data).not.toHaveProperty('createdById'); expect(data).not.toHaveProperty('createdBy'); expect(data).not.toHaveProperty('attendances');
  expect(await prisma.apiAuditLog.count({ where: { correlationId: response.headers.get('X-Request-Id')! } })).toBe(0);
  session.id = null; expect((await GET(request('GET'), context(operation.id))).status).toBe(401);
  session.id = member; expect((await GET(request('GET'), context(operation.id))).status).toBe(403);
});
test('partial edit preserves omitted fields and merges timing with stored state; past edits are accepted', async () => {
  const operation = await fixture();
  expect((await PATCH(request('PATCH', { name: ' Renamed ', frequencyIds: [radio] }), context(operation.id))).status).toBe(200);
  expect(await prisma.orbat.findUniqueOrThrow({ where: { id: operation.id } })).toMatchObject({ name: 'Renamed', startsAtUtc: operation.startsAtUtc, endsAtUtc: operation.endsAtUtc, description: operation.description });
  expect((await PATCH(request('PATCH', { endsAtUtc: '2020-01-01T14:30:00+02:00' }), context(operation.id))).status).toBe(200);
  expect((await PATCH(request('PATCH', { startsAtUtc: null }), context(operation.id))).status).toBe(422);
  expect((await PATCH(request('PATCH', { startsAtUtc: null, endsAtUtc: null, eventDateUtc: '2019-01-01T00:00:00Z', frequencyIds: [] }), context(operation.id))).status).toBe(200);
  expect(await prisma.orbatRadioFrequency.count({ where: { orbatId: operation.id } })).toBe(0);
});
test('slot swaps and cross-squad moves preserve signups and survive maximum positive order positions', async () => {
  const operation = await fixture(); const [a, b] = operation.squads;
  const one = await prisma.slot.create({ data: { orbatId: operation.id, squadId: a.id, orderIndex: 0, squadRoleId: role } });
  const two = await prisma.slot.create({ data: { orbatId: operation.id, squadId: a.id, orderIndex: 2147483647, squadRoleId: role } });
  const signup = await prisma.signup.create({ data: { slotId: one.id, userId: member } });
  const response = await PATCH(request('PATCH', { squads: [{ id: b.id, name: 'Moved', orderIndex: 0, slots: [{ id: one.id, orderIndex: 1, maxSignups: 2, squadRoleId: role }, { id: two.id, orderIndex: 0, maxSignups: 1, squadRoleId: role }] }] }), context(operation.id));
  expect(response.status).toBe(200);
  expect(await prisma.signup.findUniqueOrThrow({ where: { id: signup.id } })).toMatchObject({ slotId: one.id });
  expect(await prisma.slot.findUniqueOrThrow({ where: { id: one.id } })).toMatchObject({ squadId: b.id, orderIndex: 1 });
  expect(await prisma.squad.findUnique({ where: { id: a.id } })).toBeNull();
  expect((await prisma.apiAuditLog.findFirstOrThrow({ where: { correlationId: response.headers.get('X-Request-Id')! } })).targetUserIds).toEqual([]);
});
test('replacement omissions remove signups and attendance and audit affected user without personal notes', async () => {
  const operation = await fixture();
  const slot = await prisma.slot.create({ data: { orbatId: operation.id, squadId: operation.squads[0].id, orderIndex: 0 } });
  const signup = await prisma.signup.create({ data: { slotId: slot.id, userId: member } });
  const attendance = await prisma.attendance.create({ data: { orbatId: operation.id, signupId: signup.id, userId: member, notes: 'Sensitive attendance note' } });
  const response = await PATCH(request('PATCH', { squads: [{ name: 'Fresh squad', orderIndex: 0, slots: [{ orderIndex: 0, maxSignups: 1 }] }] }), context(operation.id));
  expect(response.status).toBe(200); expect(await prisma.attendance.findUnique({ where: { id: attendance.id } })).toBeNull();
  const audit = await prisma.apiAuditLog.findFirstOrThrow({ where: { correlationId: response.headers.get('X-Request-Id')! } });
  expect(audit.targetUserIds).toEqual([member]); expect(JSON.stringify(audit)).not.toContain('Sensitive attendance note');
});
test('validates ownership and definitions before nested mutation', async () => {
  const operation = await fixture(); const other = await fixture();
  for (const [body, status] of [
    [{ squads: [{ id: other.squads[0].id, name: 'Foreign', orderIndex: 0, slots: [{ orderIndex: 0, maxSignups: 1 }] }] }, 404],
    [{ squads: [{ name: 'Retired', orderIndex: 0, slots: [{ orderIndex: 0, maxSignups: 1, squadRoleId: retired }] }] }, 409],
    [{ frequencyIds: [2147483647] }, 404], [{ eventDate: '2020-01-01' }, 422], [{ squads: [{ id: operation.squads[0].id, name: 'Invalid', orderIndex: 0, slots: [{ orderIndex: 0, maxSignups: 1, _deleted: true }] }] }, 422],
  ] as const) expect((await PATCH(request('PATCH', body), context(operation.id))).status).toBe(status);
  expect((await prisma.orbat.findUniqueOrThrow({ where: { id: operation.id } })).name).toBe(operation.name);
});
test('bots can edit/delete with token audit; revoked tokens never fall back and anonymous deletion fails', async () => {
  const operation = await fixture();
  const updated = await PATCH(request('PATCH', { name: 'Bot changed' }, `Bearer ${token}`), context(operation.id));
  expect(updated.status).toBe(200);
  expect(await prisma.apiAuditLog.findFirstOrThrow({ where: { correlationId: updated.headers.get('X-Request-Id')! } })).toMatchObject({ actorType: 'bot', actorUserId: null });
  expect((await DELETE(request('DELETE', undefined, 'Bearer nonexistent'), context(operation.id))).status).toBe(401);
  session.id = null; expect((await DELETE(request('DELETE'), context(operation.id))).status).toBe(401);
  const deleted = await DELETE(request('DELETE', undefined, `Bearer ${token}`), context(operation.id));
  expect(await deleted.json()).toEqual({ data: null, meta: {} });
  expect(await prisma.orbat.findUnique({ where: { id: operation.id } })).toBeNull();
});
test('real transaction rolls back nested removals, outbox and audit on audit failure for edit/delete', async () => {
  const operation = await fixture();
  const slot = await prisma.slot.create({ data: { orbatId: operation.id, squadId: operation.squads[0].id, orderIndex: 0 } });
  const signup = await prisma.signup.create({ data: { slotId: slot.id, userId: member } });
  const transaction = prisma.$transaction.bind(prisma);
  const spy = vi.spyOn(prisma, '$transaction').mockImplementation(((callback: (tx: Prisma.TransactionClient) => unknown, options: unknown) => transaction(async tx => {
    const original = tx.apiAuditLog.create;
    tx.apiAuditLog.create = (() => { throw new Error('Injected audit failure'); }) as typeof original;
    try { return await callback(tx); } finally { tx.apiAuditLog.create = original; }
  }, options as never)) as typeof prisma.$transaction);
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    expect((await PATCH(request('PATCH', { name: 'Must rollback', squads: [{ name: 'Replacement', orderIndex: 0, slots: [{ orderIndex: 0, maxSignups: 1 }] }] }), context(operation.id))).status).toBe(500);
    expect((await DELETE(request('DELETE'), context(operation.id))).status).toBe(500);
  } finally { spy.mockRestore(); log.mockRestore(); }
  expect(await prisma.signup.findUnique({ where: { id: signup.id } })).not.toBeNull();
  expect((await prisma.orbat.findUniqueOrThrow({ where: { id: operation.id } })).name).toBe(operation.name);
  expect(await prisma.botEvent.count({ where: { aggregate: 'orbat', aggregateId: String(operation.id) } })).toBe(0);
  expect(await prisma.apiAuditLog.count({ where: { resource: 'orbat', resourceId: String(operation.id) } })).toBe(0);
});
