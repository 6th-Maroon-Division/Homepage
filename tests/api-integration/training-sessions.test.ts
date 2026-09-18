import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
const session = vi.hoisted(() => ({ userId: null as number | null }));
vi.mock('next-auth', () => ({ getServerSession: async () => session.userId === null ? null : { user: { id: String(session.userId) } } }));
vi.mock('@/app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
vi.mock('@/lib/realtime/training-chat-events', () => ({ publishTrainingChatEvent: vi.fn() }));
vi.mock('@/lib/realtime/user-events', () => ({ publishUserProfileEvent: vi.fn() }));
vi.mock('@/lib/realtime/inbox-events', () => ({ publishInboxEvents: vi.fn() }));
import { prisma } from '@/lib/prisma';
import { GET as list, POST as create } from '@/app/api/training-sessions/route';
import { GET as read, PATCH as update } from '@/app/api/training-sessions/[id]/route';
import { POST as add } from '@/app/api/training-sessions/[id]/attendees/route';
import { PATCH as attend, DELETE as remove } from '@/app/api/training-sessions/[id]/attendees/[attendeeId]/route';
let staff: number, member: number, outsider: number, staffPermission: number;
let index = 0;
const context = (id: number | string, attendeeId = 1) => ({ params: Promise.resolve({ id: String(id), attendeeId: String(attendeeId) }) });
const req = (method = 'GET', body?: unknown, token?: string, query = '') => new Request(`http://localhost/api/training-sessions${query}`, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
async function training() { return prisma.training.create({ data: { name: `Session integration ${++index}`, requiresTrainingSession: true, duration: 120 } }); }
async function draft() { const item = await training(); const response = await create(req('POST', { trainingId: item.id, trainerId: staff })); expect(response.status).toBe(201); return { training: item, data: (await response.json()).data }; }
async function audit(response: Response) { return prisma.apiAuditLog.findFirstOrThrow({ where: { correlationId: response.headers.get('X-Request-Id')!, outcome: 'success' } }); }
beforeAll(async () => {
  if (!process.env.API_INTEGRATION_DATABASE_URL || process.env.DATABASE_URL !== process.env.API_INTEGRATION_DATABASE_URL) throw new Error('Isolated Prisma integration database required.');
  staffPermission = (await prisma.permission.upsert({ where: { key: 'training:approve_request' }, create: { key: 'training:approve_request' }, update: {} })).id;
  staff = (await prisma.user.create({ data: { username: 'Session staff', userPermissions: { create: { permissionId: staffPermission, value: 1 } } } })).id;
  member = (await prisma.user.create({ data: { username: 'Session member' } })).id;
  outsider = (await prisma.user.create({ data: { username: 'Session outsider' } })).id;
});
beforeEach(() => { session.userId = staff; });
afterAll(async () => { await prisma.$disconnect(); });

test('scheduled creation links approved requests and atomically writes inbox, outbox and redacted audit', async () => {
  const item = await training();
  const request = await prisma.trainingRequest.create({ data: { userId: member, trainingId: item.id, status: 'approved' } });
  const response = await create(req('POST', { trainingId: item.id, trainerId: staff, attendeeUserIds: [member], status: 'scheduled', startsAt: '2026-10-01T10:00:00+02:00', specialInstructions: 'Private instructions' }));
  expect(response.status).toBe(201); const data = (await response.json()).data;
  expect(data.startsAt).toBe('2026-10-01T08:00:00.000Z'); expect(data.attendees[0].trainingRequest.id).toBe(request.id);
  expect((await prisma.trainingRequest.findUniqueOrThrow({ where: { id: request.id } })).assignedTrainerId).toBe(staff);
  expect(await prisma.trainingRequestSubscription.count({ where: { requestId: request.id, userId: staff } })).toBe(1);
  expect(await prisma.messageRecipient.count({ where: { userId: member, message: { title: `${item.name} training scheduled` } } })).toBe(1);
  expect(await prisma.botEvent.count({ where: { type: 'training.scheduled', aggregateId: String(data.id) } })).toBe(1);
  const logged = await audit(response); expect(logged).toMatchObject({ action: 'training_session.created', targetUserIds: [member] }); expect(JSON.stringify(logged)).not.toContain('Private instructions');
});

test('session state machine starts approved credentials, records history and requires attendance before completion', async () => {
  const { training: item, data } = await draft();
  const request = await prisma.trainingRequest.create({ data: { userId: member, trainingId: item.id, status: 'approved' } });
  await prisma.userTraining.create({ data: { userId: member, trainingId: item.id, status: 'approved' } });
  const added = await add(req('POST', { userId: member, trainingRequestId: request.id }), context(data.id)); expect(added.status).toBe(201); const attendee = (await added.json()).data;
  expect((await update(req('PATCH', { status: 'completed' }), context(data.id))).status).toBe(409);
  expect((await update(req('PATCH', { status: 'scheduled', startsAt: '2026-10-01T08:00:00Z' }), context(data.id))).status).toBe(200);
  expect((await update(req('PATCH', { status: 'in_progress' }), context(data.id))).status).toBe(200);
  expect((await prisma.trainingRequest.findUniqueOrThrow({ where: { id: request.id } })).status).toBe('in_training');
  expect((await prisma.userTraining.findUniqueOrThrow({ where: { userId_trainingId: { userId: member, trainingId: item.id } } })).status).toBe('in_training');
  expect(await prisma.userTrainingStatusHistory.count({ where: { trainingSessionId: data.id, toStatus: 'in_training' } })).toBe(1);
  expect((await update(req('PATCH', { status: 'completed' }), context(data.id))).status).toBe(409);
  expect((await attend(req('PATCH', { status: 'completed', notes: 'Attendance private note' }), context(data.id, attendee.id))).status).toBe(200);
  const completed = await update(req('PATCH', { status: 'completed' }), context(data.id)); expect(completed.status).toBe(200);
  expect((await prisma.userTraining.findUniqueOrThrow({ where: { userId_trainingId: { userId: member, trainingId: item.id } } })).status).toBe('in_training');
  expect((await update(req('PATCH', { status: 'scheduled' }), context(data.id))).status).toBe(409);
});

test('attendee advancement preserves approval, linked credentials and attendance remains separate from qualification', async () => {
  const { training: item, data } = await draft();
  const added = await add(req('POST', { userId: member, advanceTraining: true }), context(data.id)); expect(added.status).toBe(201); const attendee = (await added.json()).data;
  expect(attendee.trainingRequest.status).toBe('approved');
  expect((await update(req('PATCH', { status: 'scheduled', startsAt: '2026-10-02T08:00:00Z' }), context(data.id))).status).toBe(200);
  const scheduledAttendee = await prisma.trainingSessionAttendee.findUniqueOrThrow({ where: { id: attendee.id } });
  const attended = await attend(req('PATCH', { status: 'attended', expectedUpdatedAt: scheduledAttendee.updatedAt.toISOString() }), context(data.id, attendee.id)); expect(attended.status).toBe(200);
  const updated = (await attended.json()).data; expect(updated.trainingRequest.status).toBe('in_training'); expect(updated.attendedAt).toMatch(/Z$/);
  expect((await prisma.userTraining.findUniqueOrThrow({ where: { userId_trainingId: { userId: member, trainingId: item.id } } })).status).toBe('in_training');
  expect((await attend(req('PATCH', { status: 'absent', expectedUpdatedAt: attendee.updatedAt }), context(data.id, attendee.id))).status).toBe(409);
  const removed = await remove(req('DELETE', { expectedUpdatedAt: updated.updatedAt }), context(data.id, attendee.id)); expect(removed.status).toBe(200); expect((await removed.json()).data).toBeNull();
  expect((await prisma.trainingSessionAttendee.findUniqueOrThrow({ where: { id: attendee.id } })).status).toBe('cancelled');
});

test('cancellation releases request links for rescheduling, resets reminders and notifies without closing requests', async () => {
  const { training: item, data } = await draft();
  const request = await prisma.trainingRequest.create({ data: { userId: member, trainingId: item.id, status: 'approved' } });
  const attendee = (await (await add(req('POST', { userId: member, trainingRequestId: request.id }), context(data.id))).json()).data;
  const cancelled = await update(req('PATCH', { status: 'cancelled' }), context(data.id)); expect(cancelled.status).toBe(200);
  const row = await prisma.trainingSessionAttendee.findUniqueOrThrow({ where: { id: attendee.id } }); expect(row).toMatchObject({ status: 'cancelled', trainingRequestId: null, reminder24hSentAt: null });
  expect((await prisma.trainingRequest.findUniqueOrThrow({ where: { id: request.id } })).status).toBe('approved');
  expect(await prisma.botEvent.count({ where: { aggregateId: String(data.id), type: 'training.cancelled' } })).toBe(1);
  const replacement = await create(req('POST', { trainingId: item.id, trainerId: staff, attendeeUserIds: [member] })); expect(replacement.status).toBe(201);
});

test('members see only own active scheduled sessions; pagination filters before paging and reads audit other users only', async () => {
  const { data } = await draft();
  await add(req('POST', { userId: member, trainingRequestId: null }), context(data.id));
  await add(req('POST', { userId: outsider, trainingRequestId: null }), context(data.id));
  session.userId = member;
  expect((await read(req(), context(data.id))).status).toBe(404);
  expect((await (await list(req('GET', undefined, undefined, '?status=proposed'))).json()).data).toEqual([]);
  session.userId = staff; await update(req('PATCH', { status: 'scheduled', startsAt: '2026-10-03T08:00:00Z' }), context(data.id)); session.userId = member;
  const result = await read(req(), context(data.id)); const body = await result.json(); expect(body.meta.isStaff).toBe(false); expect(body.data.attendees.map((row: { userId: number }) => row.userId)).toEqual([member]);
  expect((await audit(result)).targetUserIds).toEqual([staff]);
  const listing = await list(req('GET', undefined, undefined, `?limit=1&trainingId=${data.trainingId}`)); const page = await listing.json(); expect(page.data).toHaveLength(1); expect(page.meta.nextCursor).toBeNull();
  expect(page.data[0].attendees.map((row: { userId: number }) => row.userId)).toEqual([member]);
  const unrelated = await prisma.user.create({ data: { username: 'Unrelated session member' } }); session.userId = unrelated.id; expect((await read(req(), context(data.id))).status).toBe(403);
});

test('strict validation, nonexistent request IDs and open-session conflicts cause no writes', async () => {
  const { training: item, data } = await draft();
  const before = await prisma.trainingRequest.count({ where: { userId: member, trainingId: item.id } });
  expect((await add(req('POST', { userId: member, trainingRequestId: 2_000_000_000, advanceTraining: true }), context(data.id))).status).toBe(404);
  expect(await prisma.trainingRequest.count({ where: { userId: member, trainingId: item.id } })).toBe(before);
  for (const body of [{ trainingId: String(item.id), trainerId: staff }, { trainingId: item.id, trainerId: staff, confirmed: true }, { trainingId: item.id, trainerId: staff, startsAt: '2026-10-01' }, { trainingId: item.id, trainerId: staff, attendeeUserIds: [member, member] }]) expect((await create(req('POST', body))).status).toBe(422);
  for (const query of ['?limit=0', '?cursor=2147483648', '?status=bad', '?from=2026-10-01', '?limit=1&limit=2', '?unknown=1']) expect((await list(req('GET', undefined, undefined, query))).status).toBe(400);
  expect((await update(req('PATCH', {}), context(data.id))).status).toBe(422);
  const attendee = (await (await add(req('POST', { userId: member }), context(data.id))).json()).data;
  expect((await create(req('POST', { trainingId: item.id, trainerId: staff, attendeeUserIds: [member] }))).status).toBe(409);
  await remove(req('DELETE'), context(data.id, attendee.id));
  const other = (await (await create(req('POST', { trainingId: item.id, trainerId: staff, attendeeUserIds: [member] }))).json()).data; expect(other.id).not.toBe(data.id);
  expect((await attend(req('PATCH', { status: 'scheduled' }), context(data.id, attendee.id))).status).toBe(409);
});

test('valid bots manage sessions with null actor IDs; revoked tokens cannot fall back to an authenticated user', async () => {
  const item = await training(); const bot = await prisma.botToken.create({ data: { name: 'Session integration bot', token: 'session-integration-bot' } });
  session.userId = null;
  const response = await create(req('POST', { trainingId: item.id, trainerId: staff }, bot.token)); expect(response.status).toBe(201); const data = (await response.json()).data; expect(data.createdById).toBeNull(); expect((await audit(response)).actorTokenId).toBe(bot.id);
  const attendee = await add(req('POST', { userId: member, advanceTraining: true }, bot.token), context(data.id)); expect(attendee.status).toBe(201);
  expect((await prisma.userTrainingStatusHistory.findFirstOrThrow({ where: { trainingSessionId: data.id } })).changedById).toBeNull();
  await prisma.botToken.update({ where: { id: bot.id }, data: { isActive: false } }); session.userId = staff;
  expect((await read(req('GET', undefined, bot.token), context(data.id))).status).toBe(401);
  session.userId = member; expect((await create(req('POST', { trainingId: item.id, trainerId: staff }))).status).toBe(403);
  session.userId = staff; await prisma.userPermission.update({ where: { userId_permissionId: { userId: staff, permissionId: staffPermission } }, data: { value: 0 } });
  try { expect((await update(req('PATCH', { status: 'cancelled' }), context(data.id))).status).toBe(403); } finally { await prisma.userPermission.update({ where: { userId_permissionId: { userId: staff, permissionId: staffPermission } }, data: { value: 1 } }); }
});

test('audit failure rolls back session, attendees, linked messages, inbox and outbox together', async () => {
  const item = await training(); const request = await prisma.trainingRequest.create({ data: { userId: member, trainingId: item.id, status: 'approved' } });
  const real = prisma.$transaction.bind(prisma);
  const spy = vi.spyOn(prisma, '$transaction').mockImplementation(async (...args: unknown[]) => real(async tx => (args[0] as (tx: typeof prisma) => Promise<unknown>)(new Proxy(tx, { get(target, key) { return key === 'apiAuditLog' ? { create: async () => { throw new Error('Forced audit failure'); } } : Reflect.get(target, key); } }) as typeof prisma)) as never);
  try { expect((await create(req('POST', { trainingId: item.id, trainerId: staff, attendeeUserIds: [member], status: 'scheduled', startsAt: '2026-10-01T08:00:00Z' }))).status).toBe(500); } finally { spy.mockRestore(); }
  expect(await prisma.trainingSession.count({ where: { trainingId: item.id } })).toBe(0);
  expect(await prisma.trainingRequestMessage.count({ where: { requestId: request.id } })).toBe(0);
  expect(await prisma.message.count({ where: { title: `${item.name} training scheduled` } })).toBe(0);
  expect((await prisma.trainingRequest.findUniqueOrThrow({ where: { id: request.id } })).assignedTrainerId).toBeNull();
});
