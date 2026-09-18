import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => {
  const methods = () => ({ findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn(), create: vi.fn(), createMany: vi.fn(), update: vi.fn(), updateMany: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() });
  return { session: vi.fn(), publish: vi.fn(), dm: vi.fn(), prisma: { user: methods(), userPermission: methods(), botToken: methods(), authAccount: methods(), training: methods(), trainingRequest: methods(), trainingRequestMessage: methods(), trainingRequestSubscription: methods(), trainingRequestReadState: methods(), trainingSessionAttendee: methods(), userTraining: methods(), userTrainingStatusHistory: methods(), userRank: methods(), rank: methods(), message: methods(), messageRecipient: methods(), apiAuditLog: methods(), $transaction: vi.fn() } };
});
vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }));
vi.mock('next-auth', () => ({ getServerSession: mocks.session }));
vi.mock('@/app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
vi.mock('@/lib/training-notifications', () => ({ sendDiscordTrainingDm: mocks.dm }));
vi.mock('@/lib/realtime/training-chat-events', () => ({ publishTrainingChatEvent: mocks.publish }));
vi.mock('@/lib/realtime/user-events', () => ({ publishUserProfileEvent: mocks.publish }));
vi.mock('@/lib/realtime/inbox-events', () => ({ publishInboxEvents: mocks.publish }));
import { GET as list, POST as create } from '@/app/api/training-requests/route';
import { GET as read, PATCH as update, DELETE as cancel } from '@/app/api/training-requests/[id]/route';
import { GET as messages, POST as send } from '@/app/api/training-requests/[id]/messages/route';
import { GET as subscription, PATCH as subscribe } from '@/app/api/training-requests/[id]/subscriptions/[userId]/route';
import { PATCH as markRead } from '@/app/api/training-requests/[id]/read-states/[userId]/route';
import { parseTrainingRequestBody } from '@/lib/api/training-request-contract';
const stamp = new Date('2026-09-18T00:00:00Z');
const user = { id: 3, username: 'Requester', avatarUrl: null };
const training = { id: 2, name: 'Basic', isActive: true, requiresTrainingSession: false, requiresOrbatQualification: false, rankRequirement: null, requiresTrainings: [] };
const message = { id: 10, requestId: 1, senderId: 3 as number | null, senderRole: 'USER', body: 'Private chat', createdAt: stamp, editedAt: null, sender: user };
const makeRecord = () => ({ id: 1, userId: 3, trainingId: 2, status: 'pending', requestMessage: null as string | null, adminResponse: null as string | null, requestedAt: stamp, updatedAt: stamp, training, user, assignedTrainer: null as null | typeof user, handledByAdmin: null as null | typeof user, sessionAttendee: null as unknown, messages: [message], readStates: [] as { lastReadMessageId: number; lastReadAt: Date }[], subscriptions: [] as { websiteEnabled: boolean; discordEnabled: boolean }[] });
let row: ReturnType<typeof makeRecord>;
const req = (method = 'GET', body?: unknown, bot = false, query = '') => new Request(`http://localhost/api/training-requests${query}`, { method, headers: { 'content-type': 'application/json', ...(bot ? { authorization: 'Bearer good' } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const ctx = (id = '1', userId = 'me') => ({ params: Promise.resolve({ id, userId }) });
const createBody = { userId: 3, trainingId: 2, requestMessage: 'Private request' };
const calls = [
  ['list', (bot = false) => list(req('GET', undefined, bot))], ['read', (bot = false) => read(req('GET', undefined, bot), ctx())], ['create', (bot = false) => create(req('POST', createBody, bot))],
  ['update', (bot = false) => update(req('PATCH', { status: 'approved' }, bot), ctx())], ['cancel', (bot = false) => cancel(req('DELETE', undefined, bot), ctx())],
  ['messages', (bot = false) => messages(req('GET', undefined, bot), ctx())], ['send', (bot = false) => send(req('POST', { body: 'Text' }, bot), ctx())],
  ['subscription', (bot = false) => subscription(req('GET', undefined, bot), ctx('1', bot ? '3' : 'me'))], ['subscribe', (bot = false) => subscribe(req('PATCH', { websiteEnabled: false }, bot), ctx('1', bot ? '3' : 'me'))], ['markRead', (bot = false) => markRead(req('PATCH', { lastReadMessageId: 10 }, bot), ctx('1', bot ? '3' : 'me'))],
] as const;
beforeEach(() => {
  vi.resetAllMocks(); row = makeRecord(); mocks.session.mockResolvedValue({ user: { id: '1' } });
  mocks.prisma.user.findUnique.mockImplementation(async ({ where }) => ({ ...user, id: where.id, userPermissions: [{ id: 1, permission: { key: 'training:approve_request' }, value: 2 }, { id: 2, permission: { key: 'user:edit' }, value: 2 }] }));
  mocks.prisma.user.findMany.mockResolvedValue([{ id: 1 }]); mocks.prisma.userPermission.findMany.mockResolvedValue([]); mocks.prisma.botToken.findFirst.mockResolvedValue({ id: 9 });
  mocks.prisma.training.findUnique.mockResolvedValue(training); mocks.prisma.trainingRequest.findUnique.mockImplementation(async () => row); mocks.prisma.trainingRequest.findMany.mockImplementation(async () => [row]); mocks.prisma.trainingRequest.findFirst.mockResolvedValue(null);
  mocks.prisma.trainingRequest.create.mockImplementation(async ({ data }) => { row = { ...row, ...data, subscriptions: [] }; return row; });
  mocks.prisma.trainingRequest.updateMany.mockImplementation(async ({ data }) => { row = { ...row, ...data }; return { count: 1 }; });
  mocks.prisma.trainingRequestMessage.count.mockResolvedValue(0); mocks.prisma.trainingRequestMessage.findMany.mockResolvedValue([message]); mocks.prisma.trainingRequestMessage.findFirst.mockResolvedValue(message);
  mocks.prisma.trainingRequestMessage.create.mockImplementation(async ({ data }) => ({ ...message, ...data, sender: data.senderId === null ? null : user }));
  mocks.prisma.trainingRequestSubscription.findUnique.mockResolvedValue({ websiteEnabled: true, discordEnabled: false }); mocks.prisma.trainingRequestSubscription.findMany.mockResolvedValue([{ userId: 1, websiteEnabled: true, discordEnabled: true }]);
  mocks.prisma.trainingRequestReadState.findUnique.mockResolvedValue(null); mocks.prisma.trainingRequestReadState.upsert.mockImplementation(async ({ create }) => create);
  mocks.prisma.userTraining.findUnique.mockResolvedValue(null); mocks.prisma.userTraining.upsert.mockResolvedValue({ id: 8 }); mocks.prisma.message.create.mockResolvedValue({ id: 11 });
  mocks.prisma.authAccount.count.mockResolvedValue(1); mocks.prisma.$transaction.mockImplementation(work => work(mocks.prisma));
});
it.each(calls)('%s accepts sessions and active bots with explicit targets', async (_name, call) => { expect((await call()).status).toBeLessThan(300); row = makeRecord(); expect((await call(true)).status).toBeLessThan(300); });
it.each(calls)('%s rejects absent credentials and invalid token without fallback', async (_name, call) => { mocks.session.mockResolvedValue(null); expect((await call()).status).toBe(401); mocks.session.mockResolvedValue({ user: { id: '1' } }); mocks.prisma.botToken.findFirst.mockResolvedValue(null); expect((await call(true)).status).toBe(401); });
it.each(calls.filter(([name]) => name !== 'list'))('%s rejects an unrelated nonstaff user', async (_name, call) => { mocks.prisma.user.findUnique.mockResolvedValue({ ...user, id: 1, userPermissions: [] }); expect((await call()).status).toBe(403); });
it.each(['?limit=0', '?cursor=2147483648', '?status=bad', '?status=', '?limit=1&limit=2', '?unknown=1'])('validates collection query %s', async query => { expect((await list(req('GET', undefined, false, query))).status).toBe(400); });
it('list paginates by descending ID and scopes member queries before pagination', async () => {
  mocks.prisma.trainingRequest.findMany.mockResolvedValue([row, { ...row, id: 2 }]);
  const result = await (await list(req('GET', undefined, false, '?limit=1&cursor=7&status=pending'))).json(); expect(result.meta).toEqual({ limit: 1, nextCursor: '1', isStaff: true }); expect(result.data).toHaveLength(1);
  expect(mocks.prisma.trainingRequest.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { lt: 7 }, status: 'pending' }, take: 2, orderBy: { id: 'desc' } }));
  mocks.prisma.user.findUnique.mockResolvedValue({ ...user, userPermissions: [] }); await list(req()); expect(mocks.prisma.trainingRequest.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: { userId: 1 } }));
});
it('detail and messages reads do not write read state, and conceal staff identity from requesters', async () => {
  mocks.session.mockResolvedValue({ user: { id: '3' } }); mocks.prisma.user.findUnique.mockResolvedValue({ ...user, userPermissions: [] });
  row.messages = [{ ...message, senderId: 4, senderRole: 'STAFF', sender: { ...user, id: 4, username: 'Private staff' } }]; mocks.prisma.trainingRequestMessage.findMany.mockResolvedValue(row.messages);
  const data = (await (await read(req(), ctx())).json()).data; expect(data.lastMessage.sender).toEqual({ id: null, username: 'Staff', avatarUrl: null }); expect(data.messages).toBeUndefined(); expect(data.unread).toBe(true);
  await messages(req(), ctx()); expect(mocks.prisma.trainingRequestReadState.upsert).not.toHaveBeenCalled(); expect(mocks.prisma.apiAuditLog.create).not.toHaveBeenCalled();
  row.readStates = [{ lastReadMessageId: 10, lastReadAt: stamp }]; expect((await (await read(req(), ctx())).json()).data.unread).toBe(false);
});
it('messages paginate ascending and audit returned visible users without lookahead identities', async () => {
  mocks.prisma.trainingRequestMessage.findMany.mockResolvedValue([message, { ...message, id: 11, sender: { ...user, id: 7 } }]);
  const response = await messages(req('GET', undefined, false, '?limit=1&cursor=4'), ctx()); expect((await response.json()).meta).toEqual({ limit: 1, nextCursor: '10' });
  expect(mocks.prisma.apiAuditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ targetUserIds: [3] }) });
  expect((await messages(req('GET', undefined, false, '?extra=1'), ctx())).status).toBe(400);
});
it.each(['0', 'bad', '2147483648'])('strictly parses IDs %s', async id => { for (const handler of [read, update, cancel, messages, send, subscription, subscribe, markRead]) expect((await handler(req('PATCH', { status: 'approved' }), ctx(id))).status).toBe(400); });
it('request mutations preserve credential progression, same-status handling and notification audit atomicity', async () => {
  const response = await update(req('PATCH', { status: 'approved', adminResponse: 'Private decision' }), ctx()); expect(response.status).toBe(200);
  expect(mocks.prisma.userTraining.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ status: 'approved' }) })); expect(mocks.prisma.userTrainingStatusHistory.create).toHaveBeenCalled(); expect(mocks.prisma.message.create).toHaveBeenCalled();
  expect(JSON.stringify(mocks.prisma.apiAuditLog.create.mock.calls)).not.toContain('Private decision');
  mocks.prisma.userTraining.findUnique.mockResolvedValue({ id: 8, status: 'qualified', trainerId: 7 });
  expect((await update(req('PATCH', { status: 'approved' }), ctx())).status).toBe(200); expect(mocks.prisma.userTraining.upsert).toHaveBeenLastCalledWith(expect.objectContaining({ update: { trainerId: 7 } }));
});
it('cancellation detaches attendance and removes only approved credentials', async () => {
  row.status = 'approved'; row.sessionAttendee = { id: 5 }; const response = await cancel(req('DELETE'), ctx()); expect((await response.json()).data).toBeNull();
  expect(mocks.prisma.userTraining.deleteMany).toHaveBeenCalledWith({ where: { userId: 3, trainingId: 2, status: 'approved' } }); expect(mocks.prisma.trainingSessionAttendee.updateMany).toHaveBeenCalledTimes(2);
  expect((await cancel(req('DELETE'), ctx())).status).toBe(409);
});
it('request creation validates prerequisites, existing credentials, retry cooldown and active duplicates', async () => {
  mocks.prisma.training.findUnique.mockResolvedValue(null); expect((await create(req('POST', createBody))).status).toBe(404); mocks.prisma.training.findUnique.mockResolvedValue(training);
  mocks.prisma.userTraining.findUnique.mockResolvedValue({ status: 'qualified' }); expect((await create(req('POST', createBody))).status).toBe(409);
  mocks.prisma.userTraining.findUnique.mockResolvedValue({ status: 'failed', failedAt: new Date(), statusUpdatedAt: new Date() }); const cooldown = await create(req('POST', createBody)); expect(cooldown.status).toBe(409); expect((await cooldown.json()).error.details.retryAt).toMatch(/Z$/);
  mocks.prisma.userTraining.findUnique.mockResolvedValue(null); mocks.prisma.trainingRequest.findFirst.mockResolvedValue({ id: 4 }); expect((await create(req('POST', createBody))).status).toBe(409);
});
it('on-behalf creation preserves bot authorship and denies equal/higher staff subjects', async () => {
  const response = await create(req('POST', createBody, true)); expect(response.status).toBe(201); expect(mocks.prisma.trainingRequestMessage.create).toHaveBeenCalledWith({ data: expect.objectContaining({ senderId: null, senderRole: 'STAFF' }) });
  mocks.prisma.userPermission.findMany.mockResolvedValue([{ permission: { key: 'training:approve_request' }, value: 2 }]); expect((await create(req('POST', createBody))).status).toBe(403);
});
it('posting messages writes inbox and read state inside mutation and honors preference routing', async () => {
  const sent = await send(req('POST', { body: 'Private staff message' }), ctx()); expect(sent.status).toBe(201); expect((await sent.json()).data.senderRole).toBe('STAFF'); expect(mocks.prisma.trainingRequestReadState.upsert).toHaveBeenCalled(); expect(mocks.prisma.message.create).toHaveBeenCalled(); expect(mocks.dm).not.toHaveBeenCalled();
  mocks.prisma.trainingRequestSubscription.findUnique.mockResolvedValue({ websiteEnabled: false, discordEnabled: true }); mocks.prisma.message.create.mockClear(); await send(req('POST', { body: 'Discord only' }, true), ctx()); expect(mocks.prisma.message.create).not.toHaveBeenCalled(); expect(mocks.dm).toHaveBeenCalledWith(3, expect.stringContaining('Discord only'));
  mocks.session.mockResolvedValue({ user: { id: '3' } }); await send(req('POST', { body: 'User message' }), ctx()); expect(mocks.prisma.message.create).toHaveBeenCalled(); expect(mocks.dm).toHaveBeenCalledWith(1, expect.stringContaining('User message'));
  row.status = 'cancelled'; expect((await send(req('POST', { body: 'Closed' }), ctx())).status).toBe(409);
});
it('subscriptions allow partial boolean settings and linked Discord while retaining target scope', async () => {
  expect((await subscribe(req('PATCH', { websiteEnabled: false }), ctx())).status).toBe(200); expect(mocks.prisma.trainingRequestSubscription.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: { websiteEnabled: false, discordEnabled: false } }));
  mocks.prisma.authAccount.count.mockResolvedValue(0); expect((await subscribe(req('PATCH', { discordEnabled: true }), ctx())).status).toBe(409);
  expect((await subscription(req('GET', undefined, true), ctx())).status).toBe(400);
  mocks.prisma.user.findUnique.mockImplementation(async ({ where }) => ({ ...user, id: where.id, userPermissions: where.id === 1 ? [{ id: 1, permission: { key: 'training:approve_request' }, value: 2 }] : [] }));
  expect((await subscription(req(), ctx('1', '7'))).status).toBe(403);
});
it('read receipts verify message membership and do not regress an already seen pointer', async () => {
  expect((await markRead(req('PATCH', { lastReadMessageId: 10 }), ctx())).status).toBe(200);
  mocks.prisma.trainingRequestReadState.findUnique.mockResolvedValue({ lastReadMessageId: 12, lastReadAt: stamp }); mocks.prisma.trainingRequestReadState.upsert.mockClear();
  const noOp = await markRead(req('PATCH', { lastReadMessageId: 10 }), ctx()); expect((await noOp.json()).data.lastReadMessageId).toBe(12); expect(mocks.prisma.trainingRequestReadState.upsert).not.toHaveBeenCalled();
  mocks.prisma.trainingRequestMessage.findFirst.mockResolvedValue(null); expect((await markRead(req('PATCH', { lastReadMessageId: 99 }), ctx())).status).toBe(404);
});
it.each([null, [], {}, { userId: 3, trainingId: '2' }, { userId: 3, trainingId: 2147483648 }, { userId: 3, trainingId: 2, extra: true }, { userId: 3, trainingId: 2, requestMessage: false }, { userId: 3, trainingId: 2, requestMessage: 'x'.repeat(4001) }])('rejects invalid creation body %j', body => { expect(parseTrainingRequestBody(body, 'create').error?.status).toBe(422); });
it.each([{ status: 'completed' }, { status: 'cancelled' }, { status: 'bad' }, { status: 'approved', adminResponse: 1 }, { body: '' }, { body: null }, { content: 'old alias' }])('rejects invalid status/message body %j', body => { expect(parseTrainingRequestBody(body, 'status' in body ? 'update' : 'message').error?.status).toBe(422); });
it('validates preferences, read-state payloads, query keys and malformed JSON', async () => {
  for (const body of [null, {}, { websiteEnabled: 'true' }, { discordEnabled: true, extra: true }]) expect((await subscribe(req('PATCH', body), ctx())).status).toBe(422);
  for (const body of [{}, { lastReadMessageId: '1' }, { lastReadMessageId: 1, extra: true }]) expect((await markRead(req('PATCH', body), ctx())).status).toBe(422);
  expect((await subscription(req('GET', undefined, false, '?extra=1'), ctx())).status).toBe(400);
  expect((await create(new Request('http://localhost/api/training-requests', { method: 'POST', body: '{' }))).status).toBe(400);
});
it('missing records, CAS errors and audit failures fail consistently; postcommit publication is isolated', async () => {
  mocks.prisma.trainingRequest.findUnique.mockResolvedValue(null); for (const handler of [read, update, cancel, messages, send, subscription, subscribe, markRead]) expect((await handler(req('PATCH', { status: 'approved', body: 'Message' }), ctx())).status).toBeGreaterThanOrEqual(400);
  mocks.prisma.trainingRequest.findUnique.mockImplementation(async () => row); mocks.prisma.trainingRequest.updateMany.mockResolvedValue({ count: 0 }); expect((await update(req('PATCH', { status: 'approved' }), ctx())).status).toBe(409);
  mocks.publish.mockImplementation(() => { throw new Error('publish'); }); expect((await send(req('POST', { body: 'Committed' }), ctx())).status).toBe(201);
  mocks.prisma.apiAuditLog.create.mockRejectedValue(new Error('audit')); expect((await read(req(), ctx())).status).toBe(500); expect((await send(req('POST', { body: 'Must roll back' }), ctx())).status).toBe(500);
});
