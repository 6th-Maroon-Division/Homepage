import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { Prisma } from '@/generated/prisma/client';
const session = vi.hoisted(() => ({ userId: null as number | null }));
vi.mock('next-auth', () => ({ getServerSession: async () => session.userId === null ? null : { user: { id: session.userId } } }));
vi.mock('next-auth/next', () => ({ getServerSession: async () => session.userId === null ? null : { user: { id: session.userId } } }));
vi.mock('@/app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
import { prisma } from '@/lib/prisma';
import { POST } from '@/app/api/orbats/route';
import { GET as listAdminOrbats } from '@/app/api/orbats/management/route';
let creatorId: number;
let memberId: number;
let permissionId: number;
let roleId: number;
let retiredRoleId: number;
let radioId: number;
let token: string;
let tokenId: number;
const request = (body: unknown, authorization?: string) => new NextRequest('http://localhost/api/orbats', { method: 'POST', headers: { 'content-type': 'application/json', ...(authorization ? { authorization } : {}) }, body: JSON.stringify(body) });
const payload = (name = 'ORBAT create integration') => ({ name, squads: [{ name: ' Integration squad ', orderIndex: 0, slots: [{ squadRoleId: roleId, orderIndex: 0, maxSignups: 2 }] }] });
const audits = (response: Response) => prisma.apiAuditLog.findMany({ where: { correlationId: response.headers.get('X-Request-Id')! } });
beforeAll(async () => {
  if (!process.env.API_INTEGRATION_DATABASE_URL || process.env.DATABASE_URL !== process.env.API_INTEGRATION_DATABASE_URL) throw new Error('Isolated Prisma integration database required.');
  permissionId = (await prisma.permission.upsert({ where: { key: 'orbat:create' }, create: { key: 'orbat:create' }, update: {} })).id;
  creatorId = (await prisma.user.create({ data: { username: 'ORBAT create authorized', userPermissions: { create: { permissionId, value: 1 } } } })).id;
  memberId = (await prisma.user.create({ data: { username: 'ORBAT create unauthorized' } })).id;
  roleId = (await prisma.squadRole.create({ data: { name: 'ORBAT create integration role' } })).id;
  retiredRoleId = (await prisma.squadRole.create({ data: { name: 'ORBAT create retired role', isRetired: true } })).id;
  radioId = (await prisma.radioFrequency.create({ data: { frequency: '316.777', type: 'SR' } })).id;
  const bot = await prisma.botToken.create({ data: { name: 'ORBAT create integration bot', token: 'orbat-create-integration-token' } });
  token = bot.token; tokenId = bot.id;
});
beforeEach(() => { session.userId = creatorId; });
afterAll(async () => { await prisma.$disconnect(); });

test('creation persists ordered squads roles radio links and UTC timestamps with audit and bot outbox atomically', async () => {
  const response = await POST(request({ ...payload('  ORBAT create rich integration  '), description: '  Operation description  ', startsAtUtc: '2099-10-01T20:30:00+02:00', endsAtUtc: '2099-10-01T23:00:00+02:00', timezone: 'Europe/Berlin', frequencyIds: [radioId], tempFrequencies: [{ frequency: '317.777', type: 'LR', isAdditional: false, channel: '1', callsign: 'Integration command' }], bluforCountry: 'Integration BLUFOR', isSideOp: true, squads: [{ name: 'Second squad', orderIndex: 1, slots: [{ squadRoleId: roleId, orderIndex: 0, maxSignups: 9999 }] }, { name: ' First squad ', orderIndex: 0, slots: [{ squadRoleId: roleId, orderIndex: 1, maxSignups: 2 }, { squadRoleId: roleId, orderIndex: 0, maxSignups: 1 }] }] }));
  expect(response.status).toBe(201);
  const { data } = await response.json();
  const saved = await prisma.orbat.findUniqueOrThrow({ where: { id: data.id }, include: { squads: { orderBy: { orderIndex: 'asc' }, include: { slots: { orderBy: { orderIndex: 'asc' } } } }, frequencies: true } });
  expect(saved).toMatchObject({ name: 'ORBAT create rich integration', description: 'Operation description', createdById: creatorId, startsAtUtc: new Date('2099-10-01T18:30:00Z'), endsAtUtc: new Date('2099-10-01T21:00:00Z'), eventDate: new Date('2099-10-01T18:30:00Z'), startTime: '18:30', endTime: '21:00', isSideOp: true, bluforCountry: 'Integration BLUFOR' });
  expect(saved.squads.map(squad => squad.name)).toEqual(['First squad', 'Second squad']);
  expect(saved.squads[0].slots.map(slot => [slot.orderIndex, slot.squadRoleId, slot.maxSignups])).toEqual([[0, roleId, 1], [1, roleId, 2]]);
  expect(saved.squads[1].slots[0].maxSignups).toBe(9999);
  expect(saved.frequencies.map(frequency => frequency.radioFrequencyId)).toEqual([radioId]);
  expect(data).toEqual({ id: saved.id });
  const event = await prisma.botEvent.findFirstOrThrow({ where: { aggregate: 'orbat', aggregateId: String(data.id), type: 'orbat.created' } });
  expect(event.payload).toMatchObject({ orbatId: data.id, name: saved.name, version: saved.createdAt.toISOString() });
  const entries = await audits(response);
  expect(entries).toEqual([expect.objectContaining({ action: 'orbat.created', resource: 'orbat', resourceId: String(data.id), actorType: 'user', actorUserId: creatorId, method: 'POST', path: '/api/orbats', before: null })]);
  expect(entries[0].after).toMatchObject({ startsAtUtc: '2099-10-01T18:30:00.000Z', endsAtUtc: '2099-10-01T21:00:00.000Z', roleIds: [roleId], frequencyIds: [radioId] });
  expect(JSON.stringify(entries)).not.toContain('Operation description');
  expect(JSON.stringify(entries)).not.toContain('Integration command');
});

test('bot creation uses a null human creator and audited token identity while event-only timestamps normalize to UTC', async () => {
  session.userId = null;
  const response = await POST(request({ ...payload('ORBAT bot create integration'), eventDateUtc: '2099-10-02T00:30:00+02:00' }, `Bearer ${token}`));
  expect(response.status).toBe(201);
  const { data } = await response.json();
  const saved = await prisma.orbat.findUniqueOrThrow({ where: { id: data.id } });
  expect(saved).toMatchObject({ createdById: null, startsAtUtc: null, endsAtUtc: null, eventDate: new Date('2099-10-01T22:30:00Z'), isSideOp: false });
  expect((await audits(response))[0]).toMatchObject({ actorType: 'bot', actorTokenId: tokenId, actorUserId: null });
  session.userId = creatorId;
  const adminList = await listAdminOrbats(new Request('http://localhost/api/orbats/management'));
  expect(adminList.status).toBe(200);
  expect((await adminList.json()).data.find((row: { id: number }) => row.id === data.id)).toMatchObject({ id: data.id, createdBy: null });
});

test('creation requires live grants and rejects invalid explicit tokens without session fallback', async () => {
  session.userId = null;
  expect((await POST(request(payload()))).status).toBe(401);
  session.userId = memberId;
  expect((await POST(request(payload()))).status).toBe(403);
  session.userId = creatorId;
  await prisma.userPermission.update({ where: { userId_permissionId: { userId: creatorId, permissionId } }, data: { value: 0 } });
  try { expect((await POST(request(payload()))).status).toBe(403); }
  finally { await prisma.userPermission.update({ where: { userId_permissionId: { userId: creatorId, permissionId } }, data: { value: 1 } }); }
  await prisma.botToken.update({ where: { id: tokenId }, data: { isActive: false } });
  try { for (const auth of [`Bearer ${token}`, 'Bearer invalid-orbat-create', 'Basic invalid']) expect((await POST(request(payload(), auth))).status).toBe(401); }
  finally { await prisma.botToken.update({ where: { id: tokenId }, data: { isActive: true } }); }
});

test('strict bodies timestamps and duplicate nested positions are rejected without writes', async () => {
  const before = await prisma.orbat.count();
  const invalid = [
    { ...payload(), createdById: memberId }, { ...payload(), eventDate: '2099-10-01' }, { ...payload(), startTime: '18:00' },
    { ...payload(), startsAtUtc: '2099-10-01T12:00:00' }, { ...payload(), startsAtUtc: '2000-01-01T12:00:00Z' }, { ...payload(), eventDateUtc: '2000-01-01T12:00:00Z' }, { ...payload(), startsAtUtc: '2099-02-30T12:00:00Z' },
    { ...payload(), startsAtUtc: '2099-10-01T12:00:00Z', endsAtUtc: '2099-10-01T11:00:00Z' },
    { ...payload(), squads: [{ name: 'Null capacity', orderIndex: 0, slots: [{ squadRoleId: roleId, orderIndex: 0, maxSignups: null }] }] },
    { ...payload(), name: '  ' }, { ...payload(), squads: [] }, { ...payload(), frequencyIds: [radioId, radioId] },
    { ...payload(), squads: [{ name: 'Invalid slots', orderIndex: 0, slots: [{ squadRoleId: roleId, orderIndex: 0, maxSignups: 1 }, { squadRoleId: roleId, orderIndex: 0, maxSignups: 1 }] }] },
  ];
  for (const body of invalid) expect((await POST(request(body))).status).toBe(422);
  expect(await prisma.orbat.count()).toBe(before);
});

test('missing referenced role and radio records fail before any nested operation is committed', async () => {
  const before = await prisma.orbat.count();
  for (const body of [{ ...payload(), frequencyIds: [2147483647] }, { ...payload(), squads: [{ name: 'Missing role', orderIndex: 0, slots: [{ squadRoleId: 2147483647, orderIndex: 0, maxSignups: 1 }] }] }]) expect((await POST(request(body))).status).toBe(404);
  const retired = await POST(request({ ...payload(), squads: [{ name: 'Retired role', orderIndex: 0, slots: [{ squadRoleId: retiredRoleId, orderIndex: 0, maxSignups: 1 }] }] }));
  expect(retired.status).toBe(409);
  expect(await prisma.orbat.count()).toBe(before);
});

test.each(['outbox', 'audit'] as const)('creation rolls back operation squads slots and radio links when %s persistence fails', async stage => {
  const counts = async () => Promise.all([prisma.orbat.count(), prisma.squad.count(), prisma.slot.count(), prisma.orbatRadioFrequency.count(), prisma.botEvent.count()]);
  const before = await counts();
  const transact = prisma.$transaction.bind(prisma);
  const transactionSpy = vi.spyOn(prisma, '$transaction').mockImplementation(((operation: (tx: Prisma.TransactionClient) => Promise<unknown>, options?: { maxWait?: number; timeout?: number; isolationLevel?: Prisma.TransactionIsolationLevel }) => transact(async tx => {
    const delegate = stage === 'outbox' ? tx.botEvent : tx.apiAuditLog;
    const failure = vi.spyOn(delegate, 'create').mockRejectedValue(new Error(`${stage} storage unavailable`));
    try { return await operation(tx); } finally { failure.mockRestore(); }
  }, options)) as typeof prisma.$transaction);
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  let response: Response;
  try { response = await POST(request({ ...payload(`ORBAT failed ${stage} integration`), frequencyIds: [radioId] })); }
  finally { transactionSpy.mockRestore(); log.mockRestore(); }
  expect(response.status).toBe(500);
  expect((await response.json()).data).toBeUndefined();
  expect(await counts()).toEqual(before);
  expect(await audits(response)).toEqual([]);
});
