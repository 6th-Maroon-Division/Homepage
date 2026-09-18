import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import type { Prisma } from '@/generated/prisma/client';
const session = vi.hoisted(() => ({ userId: null as number | null }));
vi.mock('next-auth', () => ({ getServerSession: async () => session.userId === null ? null : { user: { id: session.userId } } }));
vi.mock('@/app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
import { prisma } from '@/lib/prisma';
import { POST } from '@/app/api/users/merge/route';
let managerId: number;
let manageId: number;
let permissionManageId: number;
let markId: number;
let token: string;
let tokenId: number;
let sequence = 0;
const request = (body: unknown, bearer?: string, csrf = true) => new Request('http://localhost/api/users/merge', { method: 'POST', headers: { 'content-type': 'application/json', ...(bearer ? { authorization: `Bearer ${bearer}` } : {}), ...(csrf ? { cookie: 'next-auth.csrf-token=integration%7Chash', 'x-csrf-token': 'integration' } : {}) }, body: JSON.stringify(body) });
const merge = (sourceUserId: number, targetUserId: number, bearer?: string, csrf = true) => POST(request({ sourceUserId, targetUserId }, bearer, csrf));
const audits = (response: Response) => prisma.apiAuditLog.findMany({ where: { correlationId: response.headers.get('X-Request-Id')! } });
async function pair() {
  const id = ++sequence;
  const source = await prisma.user.create({ data: { username: `Merge source ${id}`, email: `private-source-${id}@example.test` } });
  const target = await prisma.user.create({ data: { username: `Merge target ${id}`, email: `private-target-${id}@example.test` } });
  return { sourceId: source.id, targetId: target.id };
}
async function richPair() {
  const { sourceId, targetId } = await pair();
  const sourceDiscord = await prisma.authAccount.create({ data: { userId: sourceId, provider: 'discord', providerUserId: `merge-source-discord-${sourceId}` } });
  const targetDiscord = await prisma.authAccount.create({ data: { userId: targetId, provider: 'discord', providerUserId: `merge-target-discord-${targetId}` } });
  const steam = await prisma.authAccount.create({ data: { userId: sourceId, provider: 'steam', providerUserId: `merge-steam-${sourceId}` } });
  await prisma.userPermission.create({ data: { userId: sourceId, permissionId: markId, value: 3 } });
  await prisma.userNotificationPreference.create({ data: { userId: sourceId, trainingReminders: true } });
  const operation = await prisma.orbat.create({ data: { name: `Merge operation ${sourceId}`, createdById: sourceId, isMainOp: true } });
  const squad = await prisma.squad.create({ data: { orbatId: operation.id, name: 'Merge squad', orderIndex: 0 } });
  const slot = await prisma.slot.create({ data: { orbatId: operation.id, squadId: squad.id, orderIndex: 0 } });
  const sourceSignup = await prisma.signup.create({ data: { slotId: slot.id, userId: sourceId } });
  const targetSignup = await prisma.signup.create({ data: { slotId: slot.id, userId: targetId } });
  const sourceAttendance = await prisma.attendance.create({ data: { signupId: sourceSignup.id, userId: sourceId, orbatId: operation.id, status: 'present', totalMinutesPresent: 60 } });
  const targetAttendance = await prisma.attendance.create({ data: { signupId: targetSignup.id, userId: targetId, orbatId: operation.id, status: 'absent' } });
  const attendanceSession = await prisma.attendanceSession.create({ data: { attendanceId: sourceAttendance.id, userId: sourceId, checkedInAt: new Date('2026-01-01T12:00:00Z'), sessionDate: new Date('2026-01-01T00:00:00Z') } });
  const attendanceLog = await prisma.attendanceLog.create({ data: { attendanceId: sourceAttendance.id, changedById: sourceId, action: 'created' } });
  const otherSlot = await prisma.slot.create({ data: { orbatId: operation.id, squadId: squad.id, orderIndex: 1 } });
  const otherSourceSignup = await prisma.signup.create({ data: { slotId: otherSlot.id, userId: sourceId } });
  const otherTargetSignup = await prisma.signup.create({ data: { slotId: otherSlot.id, userId: targetId } });
  const onlySourceAttendance = await prisma.attendance.create({ data: { signupId: otherSourceSignup.id, userId: sourceId, orbatId: operation.id, status: 'late' } });
  const training = await prisma.training.create({ data: { name: `Merge training ${sourceId}`, requiresOrbatQualification: true } });
  const sourceTraining = await prisma.userTraining.create({ data: { userId: sourceId, trainingId: training.id, status: 'qualified' } });
  const targetTraining = await prisma.userTraining.create({ data: { userId: targetId, trainingId: training.id, status: 'finished' } });
  const trainingHistory = await prisma.userTrainingStatusHistory.create({ data: { userTrainingId: sourceTraining.id, fromStatus: 'finished', toStatus: 'qualified', changedById: sourceId } });
  const trainingRequest = await prisma.trainingRequest.create({ data: { userId: sourceId, trainingId: training.id } });
  const trainingSession = await prisma.trainingSession.create({ data: { trainingId: training.id, trainerId: sourceId, createdById: sourceId, startsAt: new Date('2026-01-01T12:00:00Z') } });
  await prisma.trainingSessionAttendee.create({ data: { userId: sourceId, sessionId: trainingSession.id, trainingRequestId: trainingRequest.id, status: 'completed' } });
  const targetAttendee = await prisma.trainingSessionAttendee.create({ data: { userId: targetId, sessionId: trainingSession.id, status: 'scheduled' } });
  await prisma.trainingRequestReadState.create({ data: { userId: sourceId, requestId: trainingRequest.id, lastReadAt: new Date('2026-01-02T00:00:00Z') } });
  const targetRead = await prisma.trainingRequestReadState.create({ data: { userId: targetId, requestId: trainingRequest.id, lastReadAt: new Date('2026-01-01T00:00:00Z') } });
  await prisma.trainingRequestSubscription.create({ data: { userId: sourceId, requestId: trainingRequest.id, discordEnabled: true } });
  const targetSubscription = await prisma.trainingRequestSubscription.create({ data: { userId: targetId, requestId: trainingRequest.id, websiteEnabled: true } });
  await prisma.userRank.create({ data: { userId: sourceId, attendanceSinceLastRank: 4, retired: true } });
  await prisma.userRank.create({ data: { userId: targetId, attendanceSinceLastRank: 2, interviewDone: true } });
  return { sourceId, targetId, sourceDiscordId: sourceDiscord.id, targetDiscordId: targetDiscord.id, steamId: steam.id, operationId: operation.id, sourceSignupId: sourceSignup.id, targetSignupId: targetSignup.id, sourceAttendanceId: sourceAttendance.id, targetAttendanceId: targetAttendance.id, attendanceSessionId: attendanceSession.id, attendanceLogId: attendanceLog.id, onlySourceAttendanceId: onlySourceAttendance.id, otherTargetSignupId: otherTargetSignup.id, targetTrainingId: targetTraining.id, trainingHistoryId: trainingHistory.id, trainingRequestId: trainingRequest.id, targetAttendeeId: targetAttendee.id, targetReadId: targetRead.id, targetSubscriptionId: targetSubscription.id };
}
beforeAll(async () => {
  if (!process.env.API_INTEGRATION_DATABASE_URL || process.env.DATABASE_URL !== process.env.API_INTEGRATION_DATABASE_URL) throw new Error('Isolated Prisma database required.');
  const permission = async (key: string) => (await prisma.permission.upsert({ where: { key }, create: { key }, update: {} })).id;
  manageId = await permission('user:manage'); permissionManageId = await permission('user:manage_permissions'); markId = await permission('training:mark');
  managerId = (await prisma.user.create({ data: { username: 'Merge manager', userPermissions: { create: [{ permissionId: manageId, value: 10 }, { permissionId: permissionManageId, value: 10 }, { permissionId: markId, value: 10 }] } } })).id;
  const bot = await prisma.botToken.create({ data: { name: 'Merge bot', token: 'merge-integration-token' } });
  tokenId = bot.id; token = bot.token;
});
beforeEach(() => { session.userId = managerId; });
afterAll(async () => { await prisma.$disconnect(); });

test('bot merge preserves attendance children training histories preferences and request links while target provider wins', async () => {
  const f = await richPair();
  session.userId = null;
  const response = await merge(f.sourceId, f.targetId, token, false);
  expect(response.status).toBe(200);
  expect((await response.json()).data).toMatchObject({ removedUserId: f.sourceId, mergedIntoUserId: f.targetId, summary: { movedAccounts: 1, discardedAccounts: 1, droppedDuplicateSignups: 2, droppedDuplicateTrainings: 1 } });
  expect(await prisma.user.findUnique({ where: { id: f.sourceId } })).toBeNull();
  expect(await prisma.authAccount.findUnique({ where: { id: f.sourceDiscordId } })).toBeNull();
  expect(await prisma.authAccount.findUniqueOrThrow({ where: { id: f.targetDiscordId } })).toMatchObject({ userId: f.targetId });
  expect(await prisma.authAccount.findUniqueOrThrow({ where: { id: f.steamId } })).toMatchObject({ userId: f.targetId });
  expect((await prisma.orbat.findUniqueOrThrow({ where: { id: f.operationId } })).createdById).toBe(f.targetId);
  expect(await prisma.attendance.findUnique({ where: { id: f.sourceAttendanceId } })).toBeNull();
  expect(await prisma.attendance.findUniqueOrThrow({ where: { id: f.targetAttendanceId } })).toMatchObject({ status: 'present', totalMinutesPresent: 60 });
  expect(await prisma.attendanceSession.findUniqueOrThrow({ where: { id: f.attendanceSessionId } })).toMatchObject({ attendanceId: f.targetAttendanceId, userId: f.targetId });
  expect(await prisma.attendanceLog.findUniqueOrThrow({ where: { id: f.attendanceLogId } })).toMatchObject({ attendanceId: f.targetAttendanceId, changedById: f.targetId });
  expect(await prisma.attendance.findUniqueOrThrow({ where: { id: f.onlySourceAttendanceId } })).toMatchObject({ userId: f.targetId, signupId: f.otherTargetSignupId });
  expect((await prisma.userTraining.findUniqueOrThrow({ where: { id: f.targetTrainingId } })).status).toBe('qualified');
  expect(await prisma.userTrainingStatusHistory.findUniqueOrThrow({ where: { id: f.trainingHistoryId } })).toMatchObject({ userTrainingId: f.targetTrainingId, changedById: f.targetId });
  expect(await prisma.trainingSessionAttendee.findUniqueOrThrow({ where: { id: f.targetAttendeeId } })).toMatchObject({ userId: f.targetId, status: 'completed', trainingRequestId: f.trainingRequestId });
  expect((await prisma.trainingRequestReadState.findUniqueOrThrow({ where: { id: f.targetReadId } })).lastReadAt).toEqual(new Date('2026-01-02T00:00:00Z'));
  expect(await prisma.trainingRequestSubscription.findUniqueOrThrow({ where: { id: f.targetSubscriptionId } })).toMatchObject({ websiteEnabled: true, discordEnabled: true });
  expect(await prisma.userNotificationPreference.findUniqueOrThrow({ where: { userId: f.targetId } })).toMatchObject({ trainingReminders: true });
  expect(await prisma.userRank.findUniqueOrThrow({ where: { userId: f.targetId } })).toMatchObject({ attendanceSinceLastRank: 4, retired: true, interviewDone: true });
  const [audit] = await audits(response);
  expect(audit).toMatchObject({ actorTokenId: tokenId, actorUserId: null, action: 'user.merged', targetUserIds: [f.sourceId, f.targetId] });
  expect(JSON.stringify(audit)).not.toContain('private-source');
  expect(JSON.stringify(audit)).not.toContain('merge-source-discord');
}, 120000);

test('session merge requires CSRF and inherited permission bounds with no self or peer impersonation', async () => {
  const f = await pair();
  expect((await merge(f.sourceId, f.targetId, undefined, false)).status).toBe(403);
  expect((await merge(managerId, f.targetId)).status).toBe(403);
  expect((await merge(f.sourceId, managerId)).status).toBe(403);
  await prisma.userPermission.create({ data: { userId: f.sourceId, permissionId: markId, value: 10 } });
  expect((await merge(f.sourceId, f.targetId)).status).toBe(403);
  expect(await prisma.user.findUnique({ where: { id: f.sourceId } })).not.toBeNull();
  await prisma.userPermission.update({ where: { userId_permissionId: { userId: f.sourceId, permissionId: markId } }, data: { value: 3 } });
  await prisma.userPermission.create({ data: { userId: f.targetId, permissionId: manageId, value: 10 } });
  expect((await merge(f.sourceId, f.targetId)).status).toBe(403);
  await prisma.userPermission.delete({ where: { userId_permissionId: { userId: f.targetId, permissionId: manageId } } });
  const response = await merge(f.sourceId, f.targetId);
  expect(response.status).toBe(200);
  expect((await audits(response))[0]).toMatchObject({ actorUserId: managerId });
});

test('target duplicate grant wins and revocation or invalid IDs never mutate accounts', async () => {
  const f = await pair();
  await prisma.userPermission.createMany({ data: [{ userId: f.sourceId, permissionId: markId, value: 100 }, { userId: f.targetId, permissionId: markId, value: 2 }] });
  await prisma.botToken.update({ where: { id: tokenId }, data: { isActive: false } });
  try { expect((await merge(f.sourceId, f.targetId, token)).status).toBe(401); }
  finally { await prisma.botToken.update({ where: { id: tokenId }, data: { isActive: true } }); }
  expect((await merge(f.sourceId, 2147483647)).status).toBe(404);
  expect((await POST(request({ sourceUserId: String(f.sourceId), targetUserId: f.targetId }))).status).toBe(422);
  expect((await merge(f.sourceId, f.targetId)).status).toBe(200);
  expect((await prisma.userPermission.findUniqueOrThrow({ where: { userId_permissionId: { userId: f.targetId, permissionId: markId } } })).value).toBe(2);
});

test('audit failure restores deleted source account and every moved or deduplicated record', async () => {
  const f = await richPair();
  const transact = prisma.$transaction.bind(prisma);
  const transactionSpy = vi.spyOn(prisma, '$transaction').mockImplementation(((operation: (tx: Prisma.TransactionClient) => Promise<unknown>, options?: { maxWait?: number; timeout?: number; isolationLevel?: Prisma.TransactionIsolationLevel }) => transact(async tx => {
    const failure = vi.spyOn(tx.apiAuditLog, 'create').mockRejectedValue(new Error('Merge audit unavailable'));
    try { return await operation(tx); } finally { failure.mockRestore(); }
  }, options)) as typeof prisma.$transaction);
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  let response: Response;
  try { response = await merge(f.sourceId, f.targetId); }
  finally { transactionSpy.mockRestore(); log.mockRestore(); }
  expect(response.status).toBe(500);
  expect(await prisma.user.findUnique({ where: { id: f.sourceId } })).not.toBeNull();
  expect((await prisma.authAccount.findUniqueOrThrow({ where: { id: f.steamId } })).userId).toBe(f.sourceId);
  expect(await prisma.authAccount.findUnique({ where: { id: f.sourceDiscordId } })).not.toBeNull();
  expect(await prisma.signup.findUnique({ where: { id: f.sourceSignupId } })).not.toBeNull();
  expect((await prisma.attendanceSession.findUniqueOrThrow({ where: { id: f.attendanceSessionId } })).attendanceId).toBe(f.sourceAttendanceId);
  expect((await prisma.trainingSessionAttendee.findUniqueOrThrow({ where: { id: f.targetAttendeeId } })).trainingRequestId).toBeNull();
  expect((await prisma.userTraining.findUniqueOrThrow({ where: { id: f.targetTrainingId } })).status).toBe('finished');
  expect(await audits(response)).toEqual([]);
}, 120000);

test('real foreign-key collision maps409 and rolls back earlier provider deletion', async () => {
  const f = await richPair();
  const transact = prisma.$transaction.bind(prisma);
  const transactionSpy = vi.spyOn(prisma, '$transaction').mockImplementation(((operation: (tx: Prisma.TransactionClient) => Promise<unknown>, options?: { maxWait?: number; timeout?: number; isolationLevel?: Prisma.TransactionIsolationLevel }) => transact(async tx => {
    const update = tx.authAccount.update.bind(tx.authAccount);
    const failure = vi.spyOn(tx.authAccount, 'update').mockImplementation(((args: Parameters<typeof update>[0]) => update({ ...args, data: { userId: 2147483647 } })) as unknown as typeof tx.authAccount.update);
    try { return await operation(tx); } finally { failure.mockRestore(); }
  }, options)) as typeof prisma.$transaction);
  let response: Response;
  try { response = await merge(f.sourceId, f.targetId); }
  finally { transactionSpy.mockRestore(); }
  expect(response.status).toBe(409);
  expect(await prisma.authAccount.findUnique({ where: { id: f.sourceDiscordId } })).not.toBeNull();
  expect((await prisma.authAccount.findUniqueOrThrow({ where: { id: f.steamId } })).userId).toBe(f.sourceId);
  expect(await prisma.user.findUnique({ where: { id: f.sourceId } })).not.toBeNull();
  expect(await audits(response)).toEqual([]);
}, 120000);
