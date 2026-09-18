import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import type { Prisma } from '@/generated/prisma/client';
const mocks = vi.hoisted(() => ({ userId: null as number | null, discord: vi.fn(), publish: vi.fn() }));
vi.mock('next-auth', () => ({ getServerSession: async () => mocks.userId === null ? null : { user: { id: mocks.userId } } }));
vi.mock('@/app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
vi.mock('@/lib/training-notifications', () => ({ sendDiscordTrainingDm: mocks.discord }));
vi.mock('@/lib/realtime/inbox-events', () => ({ publishInboxEvents: mocks.publish }));
import { prisma } from '@/lib/prisma';
import { POST } from '@/app/api/training-reminders/route';
let staffId: number, permissionId: number, tokenId: number;
const token = 'training-reminders-integration-token';
let index = 0;
const req = (bearer?: string) => new Request('http://localhost/api/training-reminders', { method: 'POST', headers: { 'content-type': 'application/json', ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) }, body: '{}' });
const audits = (response: Response) => prisma.apiAuditLog.findMany({ where: { correlationId: response.headers.get('X-Request-Id')! } });
async function fixture(hours = 2, status: 'scheduled' | 'cancelled' = 'scheduled') {
  const training = await prisma.training.create({ data: { name: `Reminder training ${++index}` } });
  const user = await prisma.user.create({ data: { username: `Reminder attendee ${index}` } });
  const request = await prisma.trainingRequest.create({ data: { trainingId: training.id, userId: user.id, status: 'approved', subscriptions: { create: { userId: user.id, discordEnabled: true } } } });
  const item = await prisma.trainingSession.create({ data: { trainingId: training.id, trainerId: staffId, status, startsAt: new Date(Date.now() + hours * 3600000), attendees: { create: { userId: user.id, trainingRequestId: request.id } } }, include: { attendees: true } });
  return { training, user, item, attendee: item.attendees[0] };
}
beforeAll(async () => {
  permissionId = (await prisma.permission.upsert({ where: { key: 'training:mark' }, create: { key: 'training:mark' }, update: {} })).id;
  staffId = (await prisma.user.create({ data: { username: 'Reminder trainer', userPermissions: { create: { permissionId, value: 1 } } } })).id;
  tokenId = (await prisma.botToken.create({ data: { name: 'Reminder bot', token } })).id;
});
beforeEach(() => { mocks.userId = staffId; mocks.discord.mockReset().mockResolvedValue({ delivered: true }); mocks.publish.mockReset(); });
afterAll(async () => { await prisma.$disconnect(); });
test('delivery persists UTC claims, anonymous inbox records, one event per session and auditable recipient writes', async () => {
  const target = await fixture();
  const extra = await prisma.user.create({ data: { username: 'Reminder second attendee' } });
  const second = await prisma.trainingSessionAttendee.create({ data: { sessionId: target.item.id, userId: extra.id, status: 'attended' } });
  const distant = await fixture(25);
  const cancelled = await fixture(2, 'cancelled');
  const past = await fixture(-1);
  const response = await POST(req());
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.data.delivered).toBeGreaterThanOrEqual(2);
  expect(body.data.windowEndsAt).toMatch(/Z$/);
  for (const id of [target.attendee.id, second.id]) expect((await prisma.trainingSessionAttendee.findUniqueOrThrow({ where: { id } })).reminder24hSentAt).toBeInstanceOf(Date);
  for (const id of [distant.attendee.id, cancelled.attendee.id, past.attendee.id]) expect((await prisma.trainingSessionAttendee.findUniqueOrThrow({ where: { id } })).reminder24hSentAt).toBeNull();
  const message = await prisma.message.findFirstOrThrow({ where: { recipients: { some: { userId: target.user.id } }, title: 'Training starts within 24 hours' } });
  expect(message.createdById).toBeNull();
  expect(message.body).toContain(' UTC ');
  expect(await prisma.botEvent.count({ where: { type: 'training.reminder_due', aggregateId: String(target.item.id) } })).toBe(1);
  const log = (await audits(response)).find(entry => entry.targetUserIds.includes(target.user.id));
  expect(log).toMatchObject({ action: 'training_reminder.delivered', actorUserId: staffId, before: { reminder24hSentAt: null } });
  expect(JSON.stringify(log)).not.toContain(target.training.name);
  expect(mocks.discord).toHaveBeenCalledWith(target.user.id, expect.any(String));
  expect(mocks.discord).not.toHaveBeenCalledWith(extra.id, expect.any(String));
  const repeat = await POST(req());
  expect((await repeat.json()).data.delivered).toBe(0);
  expect(await audits(repeat)).toEqual([]);
});
test('actual transaction rollback restores earlier claims, messages and outbox when second audit fails', async () => {
  const first = await fixture();
  const second = await fixture();
  const transaction = prisma.$transaction.bind(prisma);
  const spy = vi.spyOn(prisma, '$transaction').mockImplementation(((operation: (tx: Prisma.TransactionClient) => Promise<unknown>, options?: { isolationLevel?: Prisma.TransactionIsolationLevel; timeout?: number }) => transaction(async tx => {
    const create = tx.apiAuditLog.create.bind(tx.apiAuditLog);
    let writes = 0;
    const fail = vi.spyOn(tx.apiAuditLog, 'create').mockImplementation((async args => { if (++writes === 2) throw new Error('Audit unavailable'); return create(args); }) as typeof tx.apiAuditLog.create);
    try { return await operation(tx); } finally { fail.mockRestore(); }
  }, options)) as typeof prisma.$transaction);
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  let response: Response;
  try { response = await POST(req()); } finally { spy.mockRestore(); log.mockRestore(); }
  expect(response.status).toBe(500);
  for (const target of [first, second]) {
    expect((await prisma.trainingSessionAttendee.findUniqueOrThrow({ where: { id: target.attendee.id } })).reminder24hSentAt).toBeNull();
    expect(await prisma.messageRecipient.count({ where: { userId: target.user.id } })).toBe(0);
    expect(await prisma.botEvent.count({ where: { type: 'training.reminder_due', aggregateId: String(target.item.id) } })).toBe(0);
  }
  expect(mocks.publish).not.toHaveBeenCalled(); expect(mocks.discord).not.toHaveBeenCalled();
  expect(await audits(response)).toEqual([]);
  expect((await POST(req(token))).status).toBe(200);
});
test('bot attribution, postcommit delivery failures and live rights revocation preserve correct state', async () => {
  const target = await fixture();
  mocks.publish.mockImplementation(() => { throw new Error('Listener'); });
  mocks.discord.mockRejectedValue(new Error('Discord')); 
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  let response: Response;
  try { response = await POST(req(token)); } finally { log.mockRestore(); }
  expect(response.status).toBe(200);
  expect((await response.json()).data.discordDelivered).toBe(0);
  expect((await audits(response)).find(entry => entry.targetUserIds.includes(target.user.id))).toMatchObject({ actorType: 'bot', actorTokenId: tokenId, actorUserId: null });
  await prisma.userPermission.update({ where: { userId_permissionId: { userId: staffId, permissionId } }, data: { value: 0 } });
  expect((await POST(req())).status).toBe(403);
  await prisma.userPermission.update({ where: { userId_permissionId: { userId: staffId, permissionId } }, data: { value: 1 } });
  await prisma.botToken.update({ where: { id: tokenId }, data: { isActive: false } });
  expect((await POST(req(token))).status).toBe(401);
  expect((await POST(req('not-valid'))).status).toBe(401);
});
