import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
const state = vi.hoisted(() => ({ userId: null as number | null, dm: vi.fn() }));
vi.mock('next-auth', () => ({ getServerSession: async () => state.userId === null ? null : { user: { id: String(state.userId) } } }));
vi.mock('@/app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
vi.mock('@/lib/training-notifications', () => ({ sendDiscordTrainingDm: state.dm }));
vi.mock('@/lib/realtime/training-chat-events', () => ({ publishTrainingChatEvent: vi.fn() }));
vi.mock('@/lib/realtime/user-events', () => ({ publishUserProfileEvent: vi.fn() }));
vi.mock('@/lib/realtime/inbox-events', () => ({ publishInboxEvents: vi.fn() }));
import { prisma } from '@/lib/prisma';
import { GET as list, POST as create } from '@/app/api/training-requests/route';
import { GET as read, PATCH as update, DELETE as cancel } from '@/app/api/training-requests/[id]/route';
import { GET as messages, POST as send } from '@/app/api/training-requests/[id]/messages/route';
import { GET as subscription, PATCH as subscribe } from '@/app/api/training-requests/[id]/subscriptions/[userId]/route';
import { PATCH as markRead } from '@/app/api/training-requests/[id]/read-states/[userId]/route';
import { POST as createSession } from '@/app/api/training-sessions/route';
let staff: number, member: number, outsider: number, higher: number;
let counter = 0;
const ctx = (id: number | string, userId: number | string = 'me') => ({ params: Promise.resolve({ id: String(id), userId: String(userId) }) });
const req = (method = 'GET', body?: unknown, token?: string, query = '') => new Request(`http://localhost/api/training-requests${query}`, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
async function training(session = false) { return prisma.training.create({ data: { name: `Request integration ${++counter}`, requiresTrainingSession: session, requiresOrbatQualification: false } }); }
async function requested() { const item = await training(); state.userId = member; const response = await create(req('POST', { userId: member, trainingId: item.id, requestMessage: 'Initial private request' })); expect(response.status).toBe(201); return { item, row: (await response.json()).data }; }
async function logged(response: Response) { return prisma.apiAuditLog.findFirstOrThrow({ where: { correlationId: response.headers.get('X-Request-Id')!, outcome: 'success' } }); }
beforeAll(async () => {
  if (!process.env.API_INTEGRATION_DATABASE_URL || process.env.DATABASE_URL !== process.env.API_INTEGRATION_DATABASE_URL) throw new Error('Isolated Prisma integration database required.');
  const permission = await prisma.permission.upsert({ where: { key: 'training:approve_request' }, create: { key: 'training:approve_request' }, update: {} });
  staff = (await prisma.user.create({ data: { username: 'Private request coordinator', userPermissions: { create: { permissionId: permission.id, value: 1 } } } })).id;
  higher = (await prisma.user.create({ data: { username: 'Higher request coordinator', userPermissions: { create: { permissionId: permission.id, value: 2 } } } })).id;
  member = (await prisma.user.create({ data: { username: 'Request member' } })).id;
  outsider = (await prisma.user.create({ data: { username: 'Request outsider' } })).id;
});
beforeEach(() => { state.userId = member; state.dm.mockReset(); state.dm.mockResolvedValue({ delivered: true }); });
afterAll(async () => { await prisma.$disconnect(); });

test('request creation and decisions preserve eligibility, credentials, history, notifications and redacted audit', async () => {
  const { item, row } = await requested(); expect(row.userId).toBe(member); expect(row.requestedAt).toMatch(/Z$/); expect(row.messages).toBeUndefined(); expect(row.lastMessage.body).toBe('Initial private request');
  expect(await prisma.message.count({ where: { title: `New training request: ${item.name}` } })).toBe(1);
  state.userId = staff;
  const approved = await update(req('PATCH', { status: 'approved', adminResponse: 'Private decision note' }), ctx(row.id)); expect(approved.status).toBe(200); expect((await approved.json()).data.status).toBe('approved');
  let credential = await prisma.userTraining.findUniqueOrThrow({ where: { userId_trainingId: { userId: member, trainingId: item.id } } }); expect(credential.status).toBe('approved');
  const audit = await logged(approved); expect(audit).toMatchObject({ action: 'training_request.updated', targetUserIds: [member] }); expect(JSON.stringify(audit)).not.toContain('Private decision note');
  expect((await update(req('PATCH', { status: 'qualified' }), ctx(row.id))).status).toBe(200);
  credential = await prisma.userTraining.findUniqueOrThrow({ where: { id: credential.id } }); expect(credential.status).toBe('qualified'); expect(credential.orbatQualifiedAt).not.toBeNull();
  expect(await prisma.userTrainingStatusHistory.count({ where: { userTrainingId: credential.id } })).toBe(2);
  expect((await update(req('PATCH', { status: 'approved' }), ctx(row.id))).status).toBe(409);
  expect((await cancel(req('DELETE'), ctx(row.id))).status).toBe(409);
});

test('detail/messages GET are read-only and staff names remain hidden; explicit read receipt clears unread', async () => {
  const { row } = await requested(); state.userId = staff;
  const sent = await send(req('POST', { body: 'Staff response' }), ctx(row.id)); expect(sent.status).toBe(201); const message = (await sent.json()).data;
  state.userId = member;
  const before = await prisma.trainingRequestReadState.count({ where: { requestId: row.id, userId: member } });
  const detail = await read(req(), ctx(row.id)); const data = (await detail.json()).data; expect(data.unread).toBe(true); expect(data.handledByAdmin).toBeNull(); expect(data.lastMessage.sender).toEqual({ id: null, username: 'Staff', avatarUrl: null });
  const page = await messages(req('GET', undefined, undefined, '?limit=1'), ctx(row.id)); const first = await page.json(); expect(first.data).toHaveLength(1); expect(first.meta.nextCursor).not.toBeNull();
  const next = await messages(req('GET', undefined, undefined, `?limit=1&cursor=${first.meta.nextCursor}`), ctx(row.id)); const second = await next.json(); expect(second.data[0].sender.id).toBeNull(); expect(second.meta.nextCursor).toBeNull();
  expect(JSON.stringify(data)).not.toContain('Private request coordinator');
  expect(await prisma.trainingRequestReadState.count({ where: { requestId: row.id, userId: member } })).toBe(before);
  const marked = await markRead(req('PATCH', { lastReadMessageId: message.id }), ctx(row.id)); expect(marked.status).toBe(200); expect((await logged(marked)).action).toBe('training_request_read_state.updated');
  expect((await (await read(req(), ctx(row.id))).json()).data.unread).toBe(false);
  const noOp = await markRead(req('PATCH', { lastReadMessageId: first.data[0].id }), ctx(row.id)); expect((await noOp.json()).data.lastReadMessageId).toBe(message.id);
  expect(await prisma.apiAuditLog.count({ where: { correlationId: noOp.headers.get('X-Request-Id')! } })).toBe(0);
});

test('subscriptions preserve partial preferences, require linked Discord and honor website opt-outs', async () => {
  const { row, item } = await requested();
  const defaults = await subscription(req(), ctx(row.id)); expect((await defaults.json()).data).toEqual({ websiteEnabled: true, discordEnabled: false });
  expect((await subscribe(req('PATCH', { discordEnabled: true }), ctx(row.id))).status).toBe(409);
  const off = await subscribe(req('PATCH', { websiteEnabled: false }), ctx(row.id)); expect(off.status).toBe(200); expect((await logged(off)).after).toEqual({ websiteEnabled: false, discordEnabled: false });
  const account = await prisma.authAccount.create({ data: { userId: member, provider: 'discord', providerUserId: `request-test-${row.id}` } });
  try {
    expect((await subscribe(req('PATCH', { discordEnabled: true }), ctx(row.id))).status).toBe(200);
    state.userId = staff; const sent = await send(req('POST', { body: 'Discord only' }), ctx(row.id)); expect(sent.status).toBe(201);
    expect(await prisma.message.count({ where: { title: `New ${item.name} scheduling message` } })).toBe(0); expect(state.dm).toHaveBeenCalledWith(member, expect.stringContaining('Discord only'));
  } finally { await prisma.authAccount.delete({ where: { id: account.id } }); }
});

test('list filters ownership before cursor pagination; outsiders cannot read or modify another request', async () => {
  const { row } = await requested();
  state.userId = outsider; expect((await read(req(), ctx(row.id))).status).toBe(403); expect((await messages(req(), ctx(row.id))).status).toBe(403); expect((await send(req('POST', { body: 'Denied' }), ctx(row.id))).status).toBe(403);
  expect((await subscription(req(), ctx(row.id, member))).status).toBe(403); expect((await cancel(req('DELETE'), ctx(row.id))).status).toBe(403);
  expect((await (await list(req('GET', undefined, undefined, '?limit=1'))).json()).data).toEqual([]);
  state.userId = member; let cursor: string | null = null; const ids = new Set<number>();
  do {
    const response: Response = await list(req('GET', undefined, undefined, `?limit=1${cursor ? `&cursor=${cursor}` : ''}`)); const page: { data: { id: number; userId: number }[]; meta: { nextCursor: string | null } } = await response.json();
    for (const item of page.data) { expect(item.userId).toBe(member); expect(ids.has(item.id)).toBe(false); ids.add(item.id); } cursor = page.meta.nextCursor;
  } while (cursor);
  expect(ids.has(row.id)).toBe(true);
  state.userId = staff; const other = await read(req(), ctx(row.id)); expect((await logged(other)).targetUserIds).toContain(member);
});

test('bots use explicit targets, have null message actor IDs, and revoked credentials cannot fall back', async () => {
  const item = await training(); const bot = await prisma.botToken.create({ data: { name: 'Request integration bot', token: 'request-integration-bot' } }); state.userId = null;
  const made = await create(req('POST', { userId: member, trainingId: item.id, requestMessage: 'Created by bot' }, bot.token)); expect(made.status).toBe(201); const row = (await made.json()).data;
  const stored = await prisma.trainingRequestMessage.findFirstOrThrow({ where: { requestId: row.id } }); expect(stored.senderId).toBeNull(); expect(stored.senderRole).toBe('STAFF'); expect((await logged(made)).actorTokenId).toBe(bot.id);
  expect((await subscription(req('GET', undefined, bot.token), ctx(row.id, 'me'))).status).toBe(400);
  expect((await subscribe(req('PATCH', { websiteEnabled: false }, bot.token), ctx(row.id, member))).status).toBe(200);
  expect((await markRead(req('PATCH', { lastReadMessageId: stored.id }, bot.token), ctx(row.id, member))).status).toBe(200);
  expect((await update(req('PATCH', { status: 'approved' }, bot.token), ctx(row.id))).status).toBe(200);
  await prisma.botToken.update({ where: { id: bot.id }, data: { isActive: false } }); state.userId = staff; expect((await list(req('GET', undefined, bot.token))).status).toBe(401);
  expect((await create(req('POST', { userId: higher, trainingId: (await training()).id }))).status).toBe(403);
});

test('prerequisites, retries, strict payloads and explicit request mappings are validated atomically', async () => {
  const item = await training(); const prerequisite = await training(); await prisma.trainingTrainingRequirement.create({ data: { trainingId: item.id, requiredTrainingId: prerequisite.id } });
  expect((await create(req('POST', { userId: member, trainingId: item.id }))).status).toBe(403);
  await prisma.userTraining.create({ data: { userId: member, trainingId: prerequisite.id, status: 'qualified' } });
  const created = await create(req('POST', { userId: member, trainingId: item.id })); expect(created.status).toBe(201);
  expect((await create(req('POST', { userId: member, trainingId: item.id }))).status).toBe(409);
  for (const body of [{ trainingId: item.id }, { userId: member, trainingId: String(item.id) }, { userId: member, trainingId: item.id, extra: true }]) expect((await create(req('POST', body))).status).toBe(422);
  const failed = await training(); await prisma.userTraining.create({ data: { userId: member, trainingId: failed.id, status: 'failed', failedAt: new Date(), statusUpdatedAt: new Date() } });
  const retry = await create(req('POST', { userId: member, trainingId: failed.id })); expect(retry.status).toBe(409); expect((await retry.json()).error.details.retryAt).toMatch(/Z$/);
  state.userId = staff;
  const scheduledTraining = await training(true);
  const first = await prisma.trainingRequest.create({ data: { userId: member, trainingId: scheduledTraining.id, status: 'approved' } });
  await prisma.trainingRequest.create({ data: { userId: member, trainingId: scheduledTraining.id, status: 'approved' } });
  const mapped = await createSession(req('POST', { trainingId: scheduledTraining.id, trainerId: staff, attendeeUserIds: [member], requestAssignments: [{ userId: member, trainingRequestId: first.id }], status: 'scheduled', startsAt: '2026-10-01T08:00:00Z' })); expect(mapped.status).toBe(201);
  expect((await mapped.json()).data.attendees[0].trainingRequest.id).toBe(first.id);
  expect((await createSession(req('POST', { trainingId: scheduledTraining.id, trainerId: staff, attendeeUserIds: [outsider], requestAssignments: [{ userId: outsider, trainingRequestId: first.id }] }))).status).toBe(409);
});

test('cancelling an approved request retains its attendance record while releasing association and credentials', async () => {
  const item = await training(true); const row = await prisma.trainingRequest.create({ data: { userId: member, trainingId: item.id, status: 'approved' } });
  await prisma.userTraining.create({ data: { userId: member, trainingId: item.id, status: 'approved' } });
  const session = await prisma.trainingSession.create({ data: { trainingId: item.id, trainerId: staff, attendees: { create: { userId: member, trainingRequestId: row.id } } }, include: { attendees: true } });
  const response = await cancel(req('DELETE'), ctx(row.id)); expect(response.status).toBe(200); expect((await response.json()).data).toBeNull();
  expect((await prisma.trainingSessionAttendee.findUniqueOrThrow({ where: { id: session.attendees[0].id } }))).toMatchObject({ status: 'cancelled', trainingRequestId: null });
  expect(await prisma.userTraining.findUnique({ where: { userId_trainingId: { userId: member, trainingId: item.id } } })).toBeNull();
  expect((await send(req('POST', { body: 'Closed' }), ctx(row.id))).status).toBe(409);
});

test('message audit failure rolls back chat, read state and inbox and suppresses Discord delivery', async () => {
  const { row, item } = await requested(); state.userId = staff;
  const beforeMessages = await prisma.trainingRequestMessage.count({ where: { requestId: row.id } });
  const real = prisma.$transaction.bind(prisma);
  const spy = vi.spyOn(prisma, '$transaction').mockImplementation(async (...args: unknown[]) => real(async tx => (args[0] as (tx: typeof prisma) => Promise<unknown>)(new Proxy(tx, { get(target, key) { return key === 'apiAuditLog' ? { create: async () => { throw new Error('Forced audit failure'); } } : Reflect.get(target, key); } }) as typeof prisma)) as never);
  try { expect((await send(req('POST', { body: 'Must roll back' }), ctx(row.id))).status).toBe(500); } finally { spy.mockRestore(); }
  expect(await prisma.trainingRequestMessage.count({ where: { requestId: row.id } })).toBe(beforeMessages);
  expect(await prisma.trainingRequestReadState.count({ where: { requestId: row.id, userId: staff } })).toBe(0);
  expect(await prisma.message.count({ where: { title: `New ${item.name} scheduling message` } })).toBe(0); expect(state.dm).not.toHaveBeenCalled();
});
