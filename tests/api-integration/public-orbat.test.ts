import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
const session = vi.hoisted(() => ({ userId: null as number | null }));
vi.mock('next-auth', () => ({ getServerSession: async () => session.userId === null ? null : { user: { id: String(session.userId) } } }));
vi.mock('@/app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
import { prisma } from '@/lib/prisma';
import { GET } from '@/app/api/orbats/[id]/full/route';
import { getPublicOrbat } from '@/lib/api/public-orbat';
let ownerId: number;
let otherId: number;
let orbatId: number;
let emptyOrbatId: number;
let selfOrbatId: number;
let sideOrbatId: number;
let roleId: number;
let trainingId: number;
let rankId: number;
let firstSquadId: number;
let secondSquadId: number;
let firstSlotId: number;
let secondSlotId: number;
const publicReason = 'Public attendance availability reason';
const tempFrequencies = [{ frequency: '312.456', type: 'SR', callsign: 'Public temporary radio' }];
const context = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) });
const request = (id: number | string, authorization?: string, query = '') => new Request(`http://localhost/api/orbats/${id}/full${query}`, { headers: authorization === undefined ? {} : { authorization } });
const read = (id: number | string, authorization?: string, query = '') => GET(request(id, authorization, query), context(id));
const audits = (response: Response) => prisma.apiAuditLog.findMany({ where: { correlationId: response.headers.get('X-Request-Id')! } });
beforeAll(async () => {
  if (!process.env.API_INTEGRATION_DATABASE_URL || process.env.DATABASE_URL !== process.env.API_INTEGRATION_DATABASE_URL) throw new Error('Isolated Prisma integration database required.');
  ownerId = (await prisma.user.create({ data: { username: 'Public ORBAT signup user', email: 'private-orbat-owner@example.test', avatarUrl: 'https://example.test/private-orbat-avatar.png' } })).id;
  otherId = (await prisma.user.create({ data: { username: 'Public ORBAT note user', email: 'private-orbat-note@example.test' } })).id;
  await prisma.authAccount.create({ data: { userId: ownerId, provider: 'discord', providerUserId: '930000000000000001' } });
  rankId = (await prisma.rank.create({ data: { name: 'Public ORBAT rank', abbreviation: 'POR', orderIndex: 22000 } })).id;
  await prisma.userRank.create({ data: { userId: ownerId, currentRankId: rankId, attendanceSinceLastRank: 123 } });
  trainingId = (await prisma.training.create({ data: { name: 'Public ORBAT training' } })).id;
  roleId = (await prisma.squadRole.create({ data: { name: 'Public ORBAT role', requiredTrainingIds: [trainingId], requiredRankIds: [rankId] } })).id;
  orbatId = (await prisma.orbat.create({ data: { name: 'Public full ORBAT fixture', description: 'Public operation description', createdById: ownerId, startsAtUtc: new Date('2026-10-01T18:00:00Z'), endsAtUtc: new Date('2026-10-01T20:30:00Z'), eventDate: new Date('2026-09-01T00:00:00Z'), startTime: '01:00', endTime: '02:00', timezone: 'Europe/Berlin', bluforCountry: 'BLUFOR fixture', rulesOfEngagement: 'Public engagement rules', tempFrequencies } })).id;
  secondSquadId = (await prisma.squad.create({ data: { orbatId, name: 'Second public squad', orderIndex: 1 } })).id;
  firstSquadId = (await prisma.squad.create({ data: { orbatId, name: 'First public squad', orderIndex: 0 } })).id;
  secondSlotId = (await prisma.slot.create({ data: { orbatId, squadId: firstSquadId, squadRoleId: roleId, orderIndex: 1, maxSignups: 2 } })).id;
  firstSlotId = (await prisma.slot.create({ data: { orbatId, squadId: firstSquadId, squadRoleId: roleId, orderIndex: 0, maxSignups: null } })).id;
  await prisma.signup.createMany({ data: [{ slotId: firstSlotId, userId: ownerId }, { slotId: secondSlotId, userId: ownerId }] });
  await prisma.orbatAttendanceNote.create({ data: { orbatId, userId: ownerId, status: 'unsure', reason: publicReason, createdAt: new Date('2026-09-01T12:00:00Z') } });
  await prisma.orbatAttendanceNote.create({ data: { orbatId, userId: otherId, status: 'late_unsure', lateMinutes: 15, leaveEarlyMinutes: 5, reason: 'Public lateness note', createdAt: new Date('2026-09-02T12:00:00Z') } });
  const radio = await prisma.radioFrequency.create({ data: { frequency: '312.987', type: 'SR', callsign: 'Public permanent radio', createdAt: new Date('2026-09-01T00:00:00Z') } });
  await prisma.orbatRadioFrequency.create({ data: { orbatId, radioFrequencyId: radio.id } });
  emptyOrbatId = (await prisma.orbat.create({ data: { name: 'Public empty ORBAT', createdById: ownerId } })).id;
  selfOrbatId = (await prisma.orbat.create({ data: { name: 'Public self-only ORBAT', createdById: ownerId } })).id;
  const selfSquad = await prisma.squad.create({ data: { orbatId: selfOrbatId, name: 'Self squad', orderIndex: 0 } });
  const selfSlot = await prisma.slot.create({ data: { orbatId: selfOrbatId, squadId: selfSquad.id, orderIndex: 0 } });
  await prisma.signup.create({ data: { slotId: selfSlot.id, userId: ownerId } });
  await prisma.orbatAttendanceNote.create({ data: { orbatId: selfOrbatId, userId: ownerId, status: 'unsure' } });
  sideOrbatId = (await prisma.orbat.create({ data: { name: 'Public side ORBAT', createdById: ownerId, isSideOp: true } })).id;
  const sideSquad = await prisma.squad.create({ data: { orbatId: sideOrbatId, name: 'Side squad', orderIndex: 0 } });
  await prisma.slot.create({ data: { orbatId: sideOrbatId, squadId: sideSquad.id, squadRoleId: roleId, orderIndex: 0 } });
});
beforeEach(() => { session.userId = null; });
afterAll(async () => { await prisma.$disconnect(); });

test('anonymous public ORBAT reads preserve the complete operation DTO with stable squad and slot order and UTC dates', async () => {
  const response = await read(orbatId);
  expect(response.status).toBe(200);
  const data = (await response.json()).data;
  expect(data).toMatchObject({ id: orbatId, name: 'Public full ORBAT fixture', description: 'Public operation description', eventDate: '2026-10-01T18:00:00.000Z', startsAtUtc: '2026-10-01T18:00:00.000Z', endsAtUtc: '2026-10-01T20:30:00.000Z', startTime: '18:00', endTime: '20:30', timezone: 'Europe/Berlin', bluforCountry: 'BLUFOR fixture', rulesOfEngagement: 'Public engagement rules', tempFrequencies });
  expect(data.squads.map((squad: { id: number }) => squad.id)).toEqual([firstSquadId, secondSquadId]);
  expect(data.squads[0].slots.map((slot: { id: number }) => slot.id)).toEqual([firstSlotId, secondSlotId]);
  const slot = data.squads[0].slots[0];
  expect(slot).toMatchObject({ name: 'Public ORBAT role', maxSignups: 9999, squadRoleId: roleId, requiredTrainings: [{ id: trainingId, name: 'Public ORBAT training' }], requiredRanks: [{ id: rankId, name: 'Public ORBAT rank', abbreviation: 'POR' }] });
  expect(slot.requiredTraining).toEqual(slot.requiredTrainings[0]);
  expect(slot.requiredRank).toEqual(slot.requiredRanks[0]);
  expect(slot.signups[0].user).toEqual({ id: ownerId, username: 'Public ORBAT signup user', rankAbbreviation: 'POR', rankName: 'Public ORBAT rank' });
  expect(data.frequencies[0].radioFrequency).toMatchObject({ frequency: '312.987', callsign: 'Public permanent radio', createdAt: '2026-09-01T00:00:00.000Z' });
  expect(data.attendanceNotes[0]).toMatchObject({ userId: ownerId, status: 'unsure', reason: publicReason, createdAt: '2026-09-01T12:00:00.000Z' });
  expect(data.attendanceNotes[1]).toMatchObject({ userId: otherId, lateMinutes: 15, leaveEarlyMinutes: 5, reason: 'Public lateness note', createdAt: '2026-09-02T12:00:00.000Z' });
  for (const note of data.attendanceNotes) {
    expect(Object.keys(note.user).sort()).toEqual(['id', 'username', 'userRank'].sort());
    expect(note.user.email).toBeUndefined();
    expect(note.user.avatarUrl).toBeUndefined();
    expect(note.user.accounts).toBeUndefined();
    expect(note.user.userPermissions).toBeUndefined();
  }
  expect(JSON.stringify(data)).not.toContain('private-orbat-');
  expect(JSON.stringify(data)).not.toContain('930000000000000001');
  expect(JSON.stringify(data)).not.toContain('attendanceSinceLastRank');
  expect(data.attendanceNotes[0].user.userRank).toEqual({ currentRank: { abbreviation: 'POR', name: 'Public ORBAT rank' } });
});

test('the shared server-rendering helper and public API return identical ORBAT data', async () => {
  const response = await read(orbatId);
  expect(response.status).toBe(200);
  expect(await getPublicOrbat(orbatId)).toEqual((await response.json()).data);
  expect(await getPublicOrbat(2_000_000_000)).toBeNull();
});

test('public read audits deduplicate returned signup and note identities without copying public notes', async () => {
  const anonymous = await read(orbatId);
  const anonymousAudit = await audits(anonymous);
  expect(anonymousAudit).toHaveLength(1);
  expect(anonymousAudit[0]).toMatchObject({ actorType: 'anonymous', actorUserId: null, actorTokenId: null, action: 'user_data.read', method: 'GET', path: `/api/orbats/${orbatId}/full`, before: null, after: null });
  expect([...anonymousAudit[0].targetUserIds].sort((a, b) => a - b)).toEqual([ownerId, otherId].sort((a, b) => a - b));
  expect(JSON.stringify(anonymousAudit)).not.toContain(publicReason);
  session.userId = ownerId;
  const authenticated = await read(orbatId);
  expect(authenticated.status).toBe(200);
  expect((await audits(authenticated))[0]).toMatchObject({ actorType: 'user', actorUserId: ownerId, targetUserIds: [otherId], before: null, after: null });
  const self = await read(selfOrbatId);
  expect(self.status).toBe(200);
  expect(await audits(self)).toEqual([]);
});

test('operation-only public reads do not create audits and side operations suppress role requirements', async () => {
  const empty = await read(emptyOrbatId);
  expect(empty.status).toBe(200);
  expect(await audits(empty)).toEqual([]);
  const side = await read(sideOrbatId);
  expect(side.status).toBe(200);
  const data = (await side.json()).data;
  expect(data.isSideOp).toBe(true);
  expect(data.squads[0].slots[0]).toMatchObject({ squadRoleId: roleId, requiredTrainings: [], requiredRanks: [], requiredTraining: null, requiredRank: null });
  expect(await audits(side)).toEqual([]);
});

test('valid sessions and bots receive the same public DTO while bots audit all returned users', async () => {
  const anonymous = (await (await read(orbatId)).json()).data;
  session.userId = ownerId;
  expect((await (await read(orbatId)).json()).data).toEqual(anonymous);
  const bot = await prisma.botToken.create({ data: { name: 'Public ORBAT integration bot', token: 'public-orbat-integration-token' } });
  const response = await read(orbatId, `Bearer ${bot.token}`);
  expect(response.status).toBe(200);
  expect((await response.json()).data).toEqual(anonymous);
  const row = (await audits(response))[0];
  expect(row).toMatchObject({ actorType: 'bot', actorTokenId: bot.id, before: null, after: null });
  expect([...row.targetUserIds].sort((a, b) => a - b)).toEqual([ownerId, otherId].sort((a, b) => a - b));
  await prisma.botToken.update({ where: { id: bot.id }, data: { isActive: false } });
  for (const authorization of [`Bearer ${bot.token}`, 'Bearer invalid-public-orbat-token', 'Basic invalid', 'Bearer malformed token']) expect((await read(orbatId, authorization)).status).toBe(401);
});

test('stale sessions retain anonymous public access while malformed IDs and query arguments fail', async () => {
  session.userId = 2_000_000_000;
  const stale = await read(orbatId);
  expect(stale.status).toBe(200);
  expect((await audits(stale))[0].actorType).toBe('anonymous');
  for (const id of ['0', '-1', '12abc', '2147483648']) expect((await read(id)).status).toBe(400);
  expect((await read(2_000_000_000)).status).toBe(404);
  expect((await read(orbatId, undefined, '?unknown=true')).status).toBe(400);
});

test('failed public identity-read audits prevent returning already-fetched signup and attendance details', async () => {
  const failure = vi.spyOn(prisma.apiAuditLog, 'create').mockRejectedValue(new Error('Audit storage unavailable'));
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  let response: Response;
  try { response = await read(orbatId); }
  finally { failure.mockRestore(); log.mockRestore(); }
  expect(response.status).toBe(500);
  const body = await response.json();
  expect(body.error.code).toBe('internal_error');
  expect(body.data).toBeUndefined();
  expect(JSON.stringify(body)).not.toContain('Public ORBAT signup user');
  expect(JSON.stringify(body)).not.toContain(publicReason);
});
