import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  prisma: { training: { findUnique: vi.fn(), findMany: vi.fn() }, userTraining: { findMany: vi.fn() }, userRank: { findUnique: vi.fn() }, rank: { findUnique: vi.fn() }, userPermission: { findFirst: vi.fn() }, user: { findMany: vi.fn() }, authAccount: { findFirst: vi.fn() }, message: { create: vi.fn() }, messageRecipient: { createMany: vi.fn() }, $transaction: vi.fn() },
  publish: vi.fn(), fetch: vi.fn(),
}));
vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }));
vi.mock('@/lib/realtime/inbox-events', () => ({ publishInboxEvents: mocks.publish }));
import { canRequestTraining, getOrbatTrainingAccess, getTrainingRequirements, getUnmetRequirements } from '@/lib/training-gating';
import { createTrainingNotification, sendDiscordTrainingDm } from '@/lib/training-notifications';
import { assertEligibleTrainingStaff, getEligibleTrainingStaff } from '@/lib/training-staff';
import { createSessionNotification, publishSessionNotifications } from '@/lib/api/training-session-notifications';
import type { Prisma } from '@/generated/prisma/client';
beforeEach(() => { vi.resetAllMocks(); vi.stubGlobal('fetch', mocks.fetch); vi.stubEnv('DISCORD_BOT_TOKEN', 'local-test-token'); mocks.prisma.$transaction.mockImplementation(async callback => callback(mocks.prisma)); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
it('ORBAT prerequisites deduplicate identifiers and fail closed for deleted training definitions', async () => {
  expect((await getOrbatTrainingAccess(2, [])).allowed).toBe(true);
  expect(mocks.prisma.training.findMany).not.toHaveBeenCalled();
  mocks.prisma.training.findMany.mockResolvedValue([{ id: 1, name: 'Medical', requiresOrbatQualification: true }]);
  mocks.prisma.userTraining.findMany.mockResolvedValue([{ trainingId: 1, status: 'needs_qualify' }]);
  const result = await getOrbatTrainingAccess(2, [1, 1, 9]);
  expect(result.requirements.map(item => item.id)).toEqual([1, 9]);
  expect(result.temporaryRequirements[0].id).toBe(1);
  expect(result.blockedRequirements[0]).toMatchObject({ name: 'Training #9', blockReason: 'not_started' });
});
it('missing training has no prerequisites', async () => {
  mocks.prisma.training.findUnique.mockResolvedValue(null);
  expect(await getTrainingRequirements(99)).toEqual({ minimumRank: null, requiredTrainings: [] });
  expect(await canRequestTraining(2, 99)).toBe(true);
});
it('rank and completed prerequisites are independently enforced', async () => {
  const minimumRank = { id: 3, name: 'Corporal', abbreviation: 'CPL' };
  mocks.prisma.training.findUnique.mockResolvedValue({ rankRequirement: { minimumRank }, requiresTrainings: [
    { requiredTraining: { id: 1, name: 'Medical', category: { name: 'Practical' } } },
    { requiredTraining: { id: 2, name: 'Radio', category: null } },
  ] });
  mocks.prisma.userTraining.findMany.mockResolvedValue([{ trainingId: 1, status: 'finished', training: { requiresOrbatQualification: true } }, { trainingId: 2, status: 'finished', training: { requiresOrbatQualification: false } }]);
  mocks.prisma.rank.findUnique.mockResolvedValue({ orderIndex: 3 });
  for (const userRank of [null, { currentRank: null }, { currentRank: { orderIndex: 2 } }]) {
    mocks.prisma.userRank.findUnique.mockResolvedValue(userRank);
    expect(await getUnmetRequirements(2, 7)).toMatchObject({ missingRank: minimumRank, missingTrainings: [{ id: 1 }] });
  }
  mocks.prisma.userRank.findUnique.mockResolvedValue({ currentRank: { orderIndex: 3 } });
  mocks.prisma.rank.findUnique.mockResolvedValue(null);
  expect(await canRequestTraining(2, 7)).toBe(false);
  mocks.prisma.rank.findUnique.mockResolvedValue({ orderIndex: 3 });
  mocks.prisma.userTraining.findMany.mockResolvedValue([{ trainingId: 1, status: 'qualified', training: { requiresOrbatQualification: true } }, { trainingId: 2, status: 'finished', training: { requiresOrbatQualification: false } }]);
  expect(await canRequestTraining(2, 7)).toBe(true);
  mocks.prisma.training.findUnique.mockResolvedValue({ rankRequirement: null, requiresTrainings: [] });
  expect(await canRequestTraining(2, 7)).toBe(true);
});
it('staff eligibility uses positive live permissions and returns the ordered directory', async () => {
  mocks.prisma.userPermission.findFirst.mockResolvedValue(null);
  expect(await assertEligibleTrainingStaff(1)).toBe(false);
  mocks.prisma.userPermission.findFirst.mockResolvedValue({ id: 2 });
  expect(await assertEligibleTrainingStaff(1)).toBe(true);
  mocks.prisma.user.findMany.mockResolvedValue([{ id: 1, username: 'Trainer' }]);
  expect(await getEligibleTrainingStaff()).toEqual([{ id: 1, username: 'Trainer' }]);
  expect(mocks.prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: [{ username: 'asc' }, { id: 'asc' }] }));
});
it('notifications deduplicate recipients, conceal the coordinator, and survive transaction failure', async () => {
  const input = { recipientUserIds: [], title: 'Training', body: 'Scheduled' };
  expect(await createTrainingNotification(input)).toBeNull();
  mocks.prisma.message.create.mockResolvedValue({ id: 5 });
  expect(await createTrainingNotification({ ...input, recipientUserIds: [2, 2, NaN], createdById: 9 })).toEqual({ id: 5 });
  expect(mocks.prisma.message.create).toHaveBeenCalledWith({ data: expect.objectContaining({ createdById: null, actionUrl: null }) });
  expect(mocks.prisma.messageRecipient.createMany).toHaveBeenCalledWith({ data: [{ messageId: 5, userId: 2, audienceType: 'user', channel: 'web' }], skipDuplicates: true });
  await createTrainingNotification({ ...input, recipientUserIds: [3], actionUrl: '/trainings' });
  expect(mocks.publish).toHaveBeenCalledWith([3], { source: 'training.notification', messageId: 5 });
  mocks.prisma.$transaction.mockRejectedValue(new Error('database unavailable'));
  vi.spyOn(console, 'error').mockImplementation(() => {});
  expect(await createTrainingNotification({ ...input, recipientUserIds: [2] })).toBeNull();
});
it('session notifications omit absent action URLs and publish only after collected writes', async () => {
  const notifications: { messageId: number; recipientUserIds: number[] }[] = [];
  mocks.prisma.message.create.mockResolvedValue({ id: 7 });
  await createSessionNotification({ recipientUserIds: [], title: 'T', body: 'B' }, mocks.prisma as unknown as Prisma.TransactionClient, notifications);
  await createSessionNotification({ recipientUserIds: [2, 2], title: 'T', body: 'B' }, mocks.prisma as unknown as Prisma.TransactionClient, notifications);
  expect(notifications).toEqual([{ messageId: 7, recipientUserIds: [2] }]);
  publishSessionNotifications(notifications);
  expect(mocks.publish).toHaveBeenCalledWith([2], { source: 'training.notification', messageId: 7 });
});
it('Discord notifications skip unconfigured and unlinked accounts', async () => {
  vi.stubEnv('DISCORD_BOT_TOKEN', '');
  expect(await sendDiscordTrainingDm(1, 'T')).toEqual({ delivered: false, reason: 'not_configured' });
  vi.stubEnv('DISCORD_BOT_TOKEN', 'test');
  mocks.prisma.authAccount.findFirst.mockResolvedValue(null);
  expect(await sendDiscordTrainingDm(1, 'T')).toEqual({ delivered: false, reason: 'not_linked' });
  expect(mocks.fetch).not.toHaveBeenCalled();
});
it('Discord delivery handles malformed channels, provider failures and network failures', async () => {
  mocks.prisma.authAccount.findFirst.mockResolvedValue({ providerUserId: '123' });
  for (const channel of [new Response('', { status: 403 }), Response.json({}), Response.json({ id: 'channel' })]) {
    mocks.fetch.mockResolvedValueOnce(channel).mockResolvedValueOnce(new Response('', { status: 403 }));
    expect(await sendDiscordTrainingDm(1, 'T')).toEqual({ delivered: false, reason: 'request_failed' });
    mocks.fetch.mockReset();
  }
  mocks.fetch.mockRejectedValue(new Error('offline'));
  expect(await sendDiscordTrainingDm(1, 'T')).toEqual({ delivered: false, reason: 'request_failed' });
});
it('Discord successful delivery truncates content to the provider limit', async () => {
  mocks.prisma.authAccount.findFirst.mockResolvedValue({ providerUserId: '123' });
  mocks.fetch.mockResolvedValueOnce(Response.json({ id: 'channel' })).mockResolvedValueOnce(Response.json({ id: 'message' }));
  expect(await sendDiscordTrainingDm(1, 'x'.repeat(2100))).toEqual({ delivered: true });
  expect(JSON.parse(mocks.fetch.mock.calls[1][1].body).content).toHaveLength(2000);
});

it.each([4, null, undefined])('training notifications preserve user attribution and leave bot/system senders null (%s)', async createdById => {
  mocks.prisma.message.create.mockResolvedValue({ id: 7 });
  const notifications: { messageId: number; recipientUserIds: number[] }[] = [];
  await createSessionNotification({ recipientUserIds: [2, 2], title: 'Training update', body: 'Status changed', createdById }, mocks.prisma as unknown as Prisma.TransactionClient, notifications);
  expect(mocks.prisma.message.create).toHaveBeenCalledWith({ data: { title: 'Training update', body: 'Status changed', type: 'training', actionUrl: null, createdById: createdById ?? null } });
  expect(mocks.prisma.messageRecipient.createMany).toHaveBeenCalledWith({ data: [{ messageId: 7, userId: 2, audienceType: 'user', channel: 'web' }], skipDuplicates: true });
  expect(notifications).toEqual([{ messageId: 7, recipientUserIds: [2] }]);
});
