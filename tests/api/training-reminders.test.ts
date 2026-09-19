import { beforeEach, expect, test, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ session: vi.fn(), publish: vi.fn(), discord: vi.fn(), db: { user: { findUnique: vi.fn() }, botToken: { findFirst: vi.fn(), update: vi.fn() }, trainingSessionAttendee: { findMany: vi.fn(), updateMany: vi.fn() }, message: { create: vi.fn() }, botEvent: { findFirst: vi.fn(), create: vi.fn(), deleteMany: vi.fn() }, apiAuditLog: { create: vi.fn() }, $transaction: vi.fn() } }));
vi.mock('next-auth', () => ({ getServerSession: mocks.session }));
vi.mock('@/app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
vi.mock('@/lib/prisma', () => ({ prisma: mocks.db }));
vi.mock('@/lib/training-notifications', () => ({ sendDiscordTrainingDm: mocks.discord }));
vi.mock('@/lib/realtime/inbox-events', () => ({ publishInboxEvents: mocks.publish }));
import { POST } from '@/app/api/training-reminders/route';
const req = (body: unknown = {}, headers: Record<string, string> = {}, query = '') => new Request(`http://localhost/api/training-reminders${query}`, { method: 'POST', headers, body: JSON.stringify(body) });
const attendee = (id = 1) => ({ id, userId: id + 10, sessionId: 4, session: { trainingId: 3, startsAt: new Date('2026-09-18T12:00:00Z'), updatedAt: new Date('2026-09-18T10:00:00Z'), training: { name: 'Medical' }, trainer: { username: 'Trainer' } }, trainingRequest: { id: 8, subscriptions: [{ userId: id + 10 }] } });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ user: { id: 4 } });
  mocks.db.user.findUnique.mockResolvedValue({ userPermissions: [{ permission: { key: 'training:mark' }, value: 1 }] });
  mocks.db.botToken.findFirst.mockResolvedValue({ id: 9 });
  mocks.db.trainingSessionAttendee.findMany.mockResolvedValue([attendee()]);
  mocks.db.trainingSessionAttendee.updateMany.mockResolvedValue({ count: 1 });
  mocks.db.message.create.mockResolvedValue({ id: 7 });
  mocks.db.$transaction.mockImplementation(async cb => cb(mocks.db));
  mocks.discord.mockResolvedValue({ delivered: true });
});
test('live session staff or active bot can deliver and revoked or invalid credentials never fall back', async () => {
  expect((await POST(req())).status).toBe(200);
  expect((await POST(req({}, { authorization: 'Bearer good' }))).status).toBe(200);
  mocks.db.botToken.findFirst.mockResolvedValue(null);
  expect((await POST(req({}, { authorization: 'Bearer revoked' }))).status).toBe(401);
  expect((await POST(req({}, { authorization: 'bad' }))).status).toBe(401);
  mocks.db.user.findUnique.mockResolvedValue({ userPermissions: [] });
  expect((await POST(req())).status).toBe(403);
  mocks.session.mockResolvedValue(null);
  expect((await POST(req())).status).toBe(401);
});
test('approve_request alone also grants access', async () => {
  mocks.db.user.findUnique.mockResolvedValue({ userPermissions: [{ permission: { key: 'training:approve_request' }, value: 1 }] });
  expect((await POST(req())).status).toBe(200);
});
test.each([null, [], { days: 1 }, false])('rejects nonempty/nonobject body %j', async body => {
  expect((await POST(req(body))).status).toBe(422);
  expect(mocks.db.$transaction).not.toHaveBeenCalled();
});
test('rejects query arguments and invalid JSON', async () => {
  expect((await POST(req({}, {}, '?limit=1'))).status).toBe(400);
  expect((await POST(new Request('http://localhost/api/training-reminders', { method: 'POST', body: '{' }))).status).toBe(400);
});
test('claim, inbox message, per-session durable event and audit share one transaction', async () => {
  mocks.db.trainingSessionAttendee.findMany.mockResolvedValue([attendee(), attendee(2)]);
  const response = await POST(req());
  const body = await response.json();
  expect(body.data).toEqual({ scanned: 2, delivered: 2, discordDelivered: 2, windowEndsAt: expect.stringMatching(/Z$/) });
  expect(mocks.db.botEvent.create).toHaveBeenCalledTimes(1);
  expect(mocks.db.message.create).toHaveBeenCalledTimes(2);
  expect(mocks.db.message.create).toHaveBeenCalledWith({ data: expect.objectContaining({ createdById: null, type: 'training', recipients: { create: { userId: 11, audienceType: 'user', channel: 'web' } } }) });
  expect(mocks.db.apiAuditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'training_reminder.delivered', targetUserIds: [11], after: expect.objectContaining({ reminder24hSentAt: expect.stringMatching(/Z$/), sessionId: 4 }) }) });
  expect(JSON.stringify(mocks.db.apiAuditLog.create.mock.calls)).not.toContain('Medical');
  expect(mocks.db.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'Serializable', timeout: 60000 });
});
test('lost claims and empty queues send no notification or event', async () => {
  mocks.db.trainingSessionAttendee.updateMany.mockResolvedValue({ count: 0 });
  expect((await (await POST(req())).json()).data.delivered).toBe(0);
  expect(mocks.db.message.create).not.toHaveBeenCalled();
  expect(mocks.db.botEvent.create).not.toHaveBeenCalled();
  expect(mocks.publish).not.toHaveBeenCalled();
  mocks.db.trainingSessionAttendee.findMany.mockResolvedValue([]);
  expect((await (await POST(req())).json()).data.scanned).toBe(0);
});
test('no subscription means no Discord DM and direct session notification link works', async () => {
  mocks.db.trainingSessionAttendee.findMany.mockResolvedValue([{ ...attendee(), trainingRequest: null, session: { ...attendee().session, trainer: null } }]);
  expect((await (await POST(req())).json()).data.discordDelivered).toBe(0);
  expect(mocks.discord).not.toHaveBeenCalled();
  expect(mocks.db.message.create).toHaveBeenCalledWith({ data: expect.objectContaining({ actionUrl: '/profile?tab=trainings' }) });
});
test('audit failure withholds success and publishes nothing', async () => {
  mocks.db.apiAuditLog.create.mockRejectedValue(new Error('Private audit failure'));
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const response = await POST(req());
  expect(response.status).toBe(500);
  expect(mocks.publish).not.toHaveBeenCalled();
  expect(mocks.discord).not.toHaveBeenCalled();
  log.mockRestore();
});
test('serialization conflict is retryable with no publication', async () => {
  mocks.db.$transaction.mockRejectedValue({ code: 'P2034' });
  expect((await POST(req())).status).toBe(409);
  expect(mocks.publish).not.toHaveBeenCalled();
});
test('postcommit inbox and Discord failures preserve database success', async () => {
  mocks.publish.mockImplementation(() => { throw new Error('Listener'); });
  mocks.discord.mockRejectedValue(new Error('Discord'));
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const response = await POST(req());
  expect(response.status).toBe(200);
  expect((await response.json()).data).toMatchObject({ delivered: 1, discordDelivered: 0 });
  log.mockRestore();
});
test('unscheduled records returned during a schedule race never generate reminders', async () => {
  mocks.db.trainingSessionAttendee.findMany.mockResolvedValue([{ ...attendee(), session: { ...attendee().session, startsAt: null } }]);
  expect((await (await POST(req())).json()).data.delivered).toBe(0);
  expect(mocks.db.message.create).not.toHaveBeenCalled();
});

test('later batches of the same session version reuse its durable bot event', async () => {
  mocks.db.botEvent.findFirst.mockResolvedValue({ id: BigInt(1) });
  expect((await (await POST(req())).json()).data.delivered).toBe(1);
  expect(mocks.db.message.create).toHaveBeenCalledTimes(1);
  expect(mocks.db.botEvent.create).not.toHaveBeenCalled();
});
