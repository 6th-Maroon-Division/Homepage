import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => {
  const methods = () => ({ findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), createMany: vi.fn(), update: vi.fn(), updateMany: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() });
  return { session: vi.fn(), publish: vi.fn(), prisma: { user: methods(), userPermission: methods(), botToken: methods(), training: methods(), trainingSession: methods(), trainingSessionAttendee: methods(), trainingRequest: methods(), trainingRequestSubscription: methods(), trainingRequestMessage: methods(), userTraining: methods(), userTrainingStatusHistory: methods(), message: methods(), messageRecipient: methods(), botEvent: methods(), apiAuditLog: methods(), $transaction: vi.fn() } };
});
vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }));
vi.mock('next-auth', () => ({ getServerSession: mocks.session }));
vi.mock('@/app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
vi.mock('@/lib/realtime/training-chat-events', () => ({ publishTrainingChatEvent: mocks.publish }));
vi.mock('@/lib/realtime/user-events', () => ({ publishUserProfileEvent: mocks.publish }));
vi.mock('@/lib/realtime/inbox-events', () => ({ publishInboxEvents: mocks.publish }));
import { GET as list, POST as create } from '@/app/api/training-sessions/route';
import { GET as read, PATCH as update } from '@/app/api/training-sessions/[id]/route';
import { POST as add } from '@/app/api/training-sessions/[id]/attendees/route';
import { PATCH as attend, DELETE as remove } from '@/app/api/training-sessions/[id]/attendees/[attendeeId]/route';
import { sessionDatabaseError, validateSessionBody } from '@/lib/api/training-session-contract';
const stamp = new Date('2026-09-18T00:00:00Z');
const training = { id: 2, name: 'Medical', isActive: true, requiresTrainingSession: true, duration: 120 };
const person = { id: 3, username: 'Member', avatarUrl: null };
let current: ReturnType<typeof makeSession>;
let attendee: ReturnType<typeof makeAttendee>;
function makeSession() { return { id: 1, trainingId: 2, trainerId: 4 as number | null, createdById: 1 as number | null, status: 'proposed', startsAt: null as Date | null, durationMinutes: 120 as number | null, specialInstructions: null, cancelledAt: null, createdAt: stamp, updatedAt: stamp, training, trainer: { ...person, id: 4 }, attendees: [] as { userId: number; status: string }[] }; }
function makeAttendee() { return { id: 5, sessionId: 1, userId: 3, trainingRequestId: null as number | null, status: 'scheduled', notes: null as string | null, updatedAt: stamp, attendedAt: null as Date | null, completedAt: null as Date | null, user: person, trainingRequest: null as null | { id: number; userId: number; trainingId: number; status: string; updatedAt: Date }, session: current }; }
const req = (method = 'GET', body?: unknown, bot = false, query = '') => new Request(`http://localhost/api/training-sessions${query}`, { method, headers: { 'content-type': 'application/json', ...(bot ? { authorization: 'Bearer good' } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const ctx = (id = '1', attendeeId = '5') => ({ params: Promise.resolve({ id, attendeeId }) });
const createBody = { trainingId: 2, trainerId: 4 };
const calls = [
  ['list', (bot = false) => list(req('GET', undefined, bot))], ['read', (bot = false) => read(req('GET', undefined, bot), ctx())],
  ['create', (bot = false) => create(req('POST', createBody, bot))], ['update', (bot = false) => update(req('PATCH', { specialInstructions: 'New' }, bot), ctx())],
  ['add', (bot = false) => add(req('POST', { userId: 3 }, bot), ctx())], ['attend', (bot = false) => attend(req('PATCH', { status: 'scheduled' }, bot), ctx())], ['remove', (bot = false) => remove(req('DELETE', undefined, bot), ctx())],
] as const;
beforeEach(() => {
  vi.resetAllMocks(); current = makeSession(); attendee = makeAttendee();
  mocks.session.mockResolvedValue({ user: { id: '1' } }); mocks.prisma.user.findUnique.mockResolvedValue({ ...person, userPermissions: [{ permission: { key: 'training:approve_request' }, value: 1 }] });
  mocks.prisma.user.findMany.mockImplementation(async ({ where }) => where.id.in.map((id: number) => ({ id })));
  mocks.prisma.userPermission.findFirst.mockResolvedValue({ id: 1 }); mocks.prisma.botToken.findFirst.mockResolvedValue({ id: 9 });
  mocks.prisma.training.findUnique.mockResolvedValue(training);
  mocks.prisma.trainingSession.findUnique.mockImplementation(async () => current); mocks.prisma.trainingSession.findUniqueOrThrow.mockImplementation(async () => current); mocks.prisma.trainingSession.findMany.mockImplementation(async () => [current]);
  mocks.prisma.trainingSession.create.mockImplementation(async ({ data }) => ({ ...current, ...data, attendees: [] })); mocks.prisma.trainingSession.updateMany.mockImplementation(async ({ data }) => { current = { ...current, ...data }; return { count: 1 }; });
  mocks.prisma.trainingSessionAttendee.findMany.mockResolvedValue([]); mocks.prisma.trainingSessionAttendee.findUnique.mockResolvedValue(null);
  mocks.prisma.trainingSessionAttendee.findFirst.mockImplementation(async ({ where }) => where.id === 5 ? attendee : null);
  mocks.prisma.trainingSessionAttendee.findUniqueOrThrow.mockImplementation(async () => attendee);
  mocks.prisma.trainingSessionAttendee.create.mockImplementation(async ({ data }) => { attendee = { ...attendee, ...data }; return attendee; });
  mocks.prisma.trainingSessionAttendee.updateMany.mockImplementation(async ({ data }) => { attendee = { ...attendee, ...data }; return { count: 1 }; });
  mocks.prisma.trainingRequest.findMany.mockResolvedValue([]); mocks.prisma.trainingRequest.findFirst.mockResolvedValue(null); mocks.prisma.trainingRequest.findUnique.mockResolvedValue(null);
  mocks.prisma.trainingRequest.create.mockResolvedValue({ id: 6, userId: 3, trainingId: 2, status: 'pending', updatedAt: stamp, sessionAttendee: null }); mocks.prisma.trainingRequest.updateMany.mockResolvedValue({ count: 1 });
  mocks.prisma.userTraining.findUnique.mockResolvedValue(null); mocks.prisma.userTraining.create.mockResolvedValue({ id: 7 }); mocks.prisma.userTraining.updateMany.mockResolvedValue({ count: 1 });
  mocks.prisma.message.create.mockResolvedValue({ id: 8 }); mocks.prisma.$transaction.mockImplementation(work => work(mocks.prisma));
});
it.each(calls)('%s accepts valid user and bot credentials', async (_name, call) => { expect((await call()).status).toBeLessThan(300); expect((await call(true)).status).toBeLessThan(300); });
it.each(calls)('%s rejects missing credentials and invalid bearer without session fallback', async (_name, call) => { mocks.session.mockResolvedValue(null); expect((await call()).status).toBe(401); mocks.session.mockResolvedValue({ user: { id: '1' } }); mocks.prisma.botToken.findFirst.mockResolvedValue(null); expect((await call(true)).status).toBe(401); });
it.each(calls.slice(2))('%s requires live training staff rights', async (_name, call) => { mocks.prisma.user.findUnique.mockResolvedValue({ userPermissions: [] }); expect((await call()).status).toBe(403); expect(mocks.prisma.$transaction).not.toHaveBeenCalled(); });
it.each(['?limit=0', '?cursor=2147483648', '?status=unknown', '?trainingId=0', '?trainerId=no', '?from=2026-10-01', '?to=bad', '?from=2026-10-02T00:00:00Z&to=2026-10-01T00:00:00Z', '?limit=1&limit=2', '?unknown=true'])('validates list query %s', async query => { expect((await list(req('GET', undefined, false, query))).status).toBe(400); });
it('list uses filtered descending cursor pages and audits only returned others', async () => {
  mocks.prisma.trainingSession.findMany.mockResolvedValue([{ ...current, trainerId: 1, attendees: [{ userId: 1 }] }, { ...current, id: 2, trainerId: 4 }]);
  const response = await list(req('GET', undefined, false, '?limit=1&cursor=5&trainingId=2&trainerId=4&status=scheduled&from=2026-10-01T02:00:00%2B02:00&to=2026-10-02T00:00:00Z'));
  const body = await response.json(); expect(body.meta).toEqual({ limit: 1, nextCursor: '1', isStaff: true }); expect(body.data).toHaveLength(1);
  expect(mocks.prisma.trainingSession.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: { lt: 5 }, trainingId: 2, trainerId: 4, startsAt: { gte: new Date('2026-10-01T00:00:00Z'), lt: new Date('2026-10-02T00:00:00Z') } }), take: 2 }));
  expect(mocks.prisma.apiAuditLog.create).not.toHaveBeenCalled();
});
it('members are scoped to own active attendance and do not see draft/cancelled sessions', async () => {
  mocks.prisma.user.findUnique.mockResolvedValue({ userPermissions: [] }); current.attendees = [{ userId: 1, status: 'scheduled' }, { userId: 3, status: 'scheduled' }];
  expect((await read(req(), ctx())).status).toBe(404); current.status = 'scheduled';
  const response = await read(req(), ctx()); const body = await response.json(); expect(body.data.attendees).toEqual([{ userId: 1, status: 'scheduled' }]); expect(body.meta.isStaff).toBe(false);
  expect(mocks.prisma.apiAuditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ targetUserIds: [4] }) });
  current.attendees = []; expect((await read(req(), ctx())).status).toBe(403);
  expect((await (await list(req('GET', undefined, false, '?status=cancelled'))).json()).data).toEqual([]);
  await list(req()); expect(mocks.prisma.trainingSession.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: expect.objectContaining({ attendees: { some: { userId: 1, status: { not: 'cancelled' } } }, status: { notIn: ['proposed', 'cancelled'] } }) }));
});
it('read audit failure fails closed and query keys and IDs are strict', async () => {
  mocks.prisma.apiAuditLog.create.mockRejectedValue(new Error('audit')); expect((await read(req(), ctx())).status).toBe(500);
  expect((await read(req('GET', undefined, false, '?extra=1'), ctx())).status).toBe(400);
  for (const id of ['bad', '0', '2147483648']) for (const handler of [read, update, add, attend, remove]) expect((await handler(req('PATCH', { status: 'scheduled' }), ctx(id))).status).toBe(400);
});
it.each([['create', {}], ['create', { trainingId: '2', trainerId: 4 }], ['create', { ...createBody, confirmed: true }], ['create', { ...createBody, attendeeUserIds: [3, 3] }], ['create', { ...createBody, attendeeUserIds: [null] }], ['update', {}], ['update', { durationMinutes: 1441 }], ['update', { startsAt: '2026-10-01' }], ['update', { trainerId: 0 }], ['update', { status: 'bad' }], ['add', { userId: 3, advanceTraining: 'true' }], ['add', { userId: 3, notes: 4 }], ['attendee', { status: 'attended', expectedUpdatedAt: '2026-10-01' }], ['attendee', { status: 'bad' }], ['remove', { status: 'cancelled' }]])('rejects strict %s body %j', async (kind, body) => { expect((await validateSessionBody(req('POST', body), kind as 'create'))?.status).toBe(422); });
it('body validation rejects query, empty objects, long notes and malformed JSON', async () => {
  expect((await validateSessionBody(req('POST', null), 'create'))?.status).toBe(422);
  expect((await validateSessionBody(req('PATCH', { notes: 'x'.repeat(4001), status: 'attended' }), 'attendee'))?.status).toBe(422);
  expect((await create(req('POST', createBody, false, '?x=1'))).status).toBe(400);
  expect((await create(new Request('http://localhost/api/training-sessions', { method: 'POST', body: '{' }))).status).toBe(400);
});
it('scheduled create normalizes offsets and writes transactional notifications, linked messages, audit and outbox', async () => {
  mocks.prisma.trainingRequest.findMany.mockResolvedValue([{ id: 6, userId: 3, status: 'approved', sessionAttendee: null }]);
  const response = await create(req('POST', { ...createBody, startsAt: '2026-10-01T10:00:00+02:00', status: 'scheduled', attendeeUserIds: [3], specialInstructions: 'Private' }, true)); expect(response.status).toBe(201);
  expect((await response.json()).data).toMatchObject({ createdById: null, startsAt: '2026-10-01T08:00:00.000Z' });
  expect(mocks.prisma.trainingRequestMessage.createMany).toHaveBeenCalled(); expect(mocks.prisma.messageRecipient.createMany).toHaveBeenCalled(); expect(mocks.prisma.botEvent.create).toHaveBeenCalled();
  expect(mocks.prisma.apiAuditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'training_session.created', actorTokenId: 9, targetUserIds: [3] }) });
});
it('creation rejects invalid training capabilities, missing refs, pending requests and existing assignments', async () => {
  mocks.prisma.training.findUnique.mockResolvedValue(null); expect((await create(req('POST', createBody))).status).toBe(404);
  for (const override of [{ isActive: false }, { requiresTrainingSession: false }]) { mocks.prisma.training.findUnique.mockResolvedValue({ ...training, ...override }); expect((await create(req('POST', createBody))).status).toBe(409); }
  mocks.prisma.training.findUnique.mockResolvedValue(training);
  expect((await create(req('POST', { ...createBody, status: 'scheduled' }))).status).toBe(422);
  mocks.prisma.trainingRequest.findMany.mockResolvedValue([{ id: 6, userId: 3, status: 'pending', sessionAttendee: null }]); expect((await create(req('POST', { ...createBody, startsAt: stamp.toISOString(), status: 'scheduled', attendeeUserIds: [3] }))).status).toBe(409);
  mocks.prisma.trainingRequest.findMany.mockResolvedValue([{ id: 6, userId: 3, status: 'approved', sessionAttendee: { id: 8, sessionId: 9, status: 'scheduled', session: { status: 'scheduled' } } }]); expect((await create(req('POST', { ...createBody, attendeeUserIds: [3] }))).status).toBe(409);
  mocks.prisma.trainingRequest.findMany.mockResolvedValue([]); mocks.prisma.trainingSessionAttendee.findMany.mockResolvedValue([{ userId: 3, sessionId: 9 }]); expect((await create(req('POST', { ...createBody, attendeeUserIds: [3] }))).status).toBe(409);
});
it('updates schedule, assigned trainer, cancellation and outbox atomically', async () => {
  mocks.prisma.trainingSessionAttendee.findMany.mockResolvedValue([{ userId: 3, status: 'scheduled', trainingRequest: { id: 6, status: 'approved' } }]);
  expect((await update(req('PATCH', { status: 'scheduled', startsAt: stamp.toISOString(), trainerId: 8 }), ctx())).status).toBe(200);
  expect(mocks.prisma.message.create).toHaveBeenCalledTimes(2); expect(mocks.prisma.botEvent.create).toHaveBeenCalled();
  expect((await update(req('PATCH', { status: 'cancelled' }), ctx())).status).toBe(200);
  expect(mocks.prisma.trainingSessionAttendee.updateMany).toHaveBeenCalledWith({ where: { sessionId: 1, trainingRequestId: { not: null } }, data: { trainingRequestId: null } });
  expect((await update(req('PATCH', { status: 'scheduled' }), ctx())).status).toBe(409);
});
it('session progression creates credential history and blocks completion with unrecorded attendance', async () => {
  current.status = 'scheduled'; current.startsAt = stamp;
  mocks.prisma.trainingSessionAttendee.findMany.mockResolvedValue([{ userId: 3, status: 'scheduled', trainingRequest: { id: 6, status: 'approved' } }]);
  mocks.prisma.trainingRequest.findMany.mockResolvedValue([{ id: 6, userId: 3, trainingId: 2, updatedAt: stamp }]);
  expect((await update(req('PATCH', { status: 'in_progress' }), ctx())).status).toBe(200); expect(mocks.prisma.userTrainingStatusHistory.create).toHaveBeenCalled();
  expect((await update(req('PATCH', { status: 'completed' }), ctx())).status).toBe(409);
  current.status = 'in_progress'; // The real database rolls back the rejected completion above.
  mocks.prisma.trainingSessionAttendee.findMany.mockResolvedValue([{ userId: 3, status: 'attended', trainingRequest: null }]);
  expect((await update(req('PATCH', { status: 'completed' }), ctx())).status).toBe(200);
});
it('adding an attendee can create/advance a request and credential with transactional system messages', async () => {
  const response = await add(req('POST', { userId: 3, advanceTraining: true, notes: 'Private notes' }), ctx()); expect(response.status).toBe(201);
  expect(mocks.prisma.trainingRequest.create).toHaveBeenCalled(); expect(mocks.prisma.userTraining.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'approved' }) }));
  expect(mocks.prisma.userTrainingStatusHistory.create).toHaveBeenCalled(); expect(mocks.prisma.messageRecipient.createMany).toHaveBeenCalled();
  expect(JSON.stringify(mocks.prisma.apiAuditLog.create.mock.calls)).not.toContain('Private notes');
});
it('adding checks explicit missing requests, mismatched requests, duplicates and pending scheduling conflicts', async () => {
  expect((await add(req('POST', { userId: 3, trainingRequestId: 999, advanceTraining: true }), ctx())).status).toBe(404); expect(mocks.prisma.trainingRequest.create).not.toHaveBeenCalled();
  mocks.prisma.trainingRequest.findUnique.mockResolvedValue({ id: 6, userId: 9, trainingId: 2, status: 'approved' }); expect((await add(req('POST', { userId: 3, trainingRequestId: 6 }), ctx())).status).toBe(409);
  mocks.prisma.trainingSessionAttendee.findUnique.mockResolvedValue({ status: 'cancelled' }); expect((await add(req('POST', { userId: 3 }), ctx())).status).toBe(409);
  mocks.prisma.trainingSessionAttendee.findUnique.mockResolvedValue(null); current.status = 'scheduled'; mocks.prisma.trainingRequest.findFirst.mockResolvedValue({ id: 6, userId: 3, trainingId: 2, status: 'pending', sessionAttendee: null });
  expect((await add(req('POST', { userId: 3 }), ctx())).status).toBe(409);
});
it('attendee progress starts approved credentials and never grants qualification', async () => {
  current.status = 'scheduled'; attendee.trainingRequestId = 6; attendee.trainingRequest = { id: 6, userId: 3, trainingId: 2, status: 'approved', updatedAt: stamp };
  const response = await attend(req('PATCH', { status: 'completed', expectedUpdatedAt: stamp.toISOString(), notes: 'Private' }), ctx()); expect(response.status).toBe(200);
  expect(mocks.prisma.userTraining.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'in_training' }) })); expect(mocks.prisma.userTrainingStatusHistory.create).toHaveBeenCalled();
  expect(mocks.prisma.trainingRequestMessage.create).toHaveBeenCalledTimes(2); expect(mocks.prisma.message.create).toHaveBeenCalled();
});
it('attendee transitions honor CAS and session status and guard restoration conflicts', async () => {
  expect((await attend(req('PATCH', { status: 'completed' }), ctx())).status).toBe(409);
  expect((await attend(req('PATCH', { status: 'scheduled', expectedUpdatedAt: '2020-01-01T00:00:00Z' }), ctx())).status).toBe(409);
  current.status = 'completed'; expect((await attend(req('PATCH', { status: 'scheduled' }), ctx())).status).toBe(409);
  current.status = 'cancelled'; expect((await attend(req('PATCH', { status: 'attended' }), ctx())).status).toBe(409);
  current.status = 'scheduled'; attendee.status = 'cancelled'; mocks.prisma.trainingSessionAttendee.findFirst.mockResolvedValue(attendee);
  expect((await attend(req('PATCH', { status: 'scheduled' }), ctx())).status).toBe(409);
});
it('CAS and audit failures propagate correctly; postcommit notifications cannot turn success into failure', async () => {
  mocks.prisma.trainingSession.updateMany.mockResolvedValue({ count: 0 }); expect((await update(req('PATCH', { specialInstructions: 'X' }), ctx())).status).toBe(409);
  mocks.prisma.trainingSessionAttendee.updateMany.mockResolvedValue({ count: 0 }); expect((await attend(req('PATCH', { status: 'scheduled' }), ctx())).status).toBe(409);
  mocks.publish.mockImplementation(() => { throw new Error('publish'); }); expect((await add(req('POST', { userId: 3 }), ctx())).status).toBe(201);
  mocks.prisma.apiAuditLog.create.mockRejectedValue(new Error('audit')); expect((await create(req('POST', createBody))).status).toBe(500);
});
it('maps database races and missing rows', () => { expect(sessionDatabaseError({ code: 'P2025' }).status).toBe(404); for (const code of ['P2002', 'P2003', 'P2034']) expect(sessionDatabaseError({ code }).status).toBe(409); expect(() => sessionDatabaseError(new Error('oops'))).toThrow('oops'); });

it('explicit request assignments select the requested record and validate mapping before writes', async () => {
  const assignment = { userId: 3, trainingRequestId: 6 };
  const requestRow = { id: 6, userId: 3, trainingId: 2, status: 'approved', sessionAttendee: null };
  mocks.prisma.trainingRequest.findMany.mockImplementation(async ({ where }) => where.id ? [requestRow] : [{ ...requestRow, id: 9 }]);
  const response = await create(req('POST', { ...createBody, attendeeUserIds: [3], requestAssignments: [assignment] })); expect(response.status).toBe(201);
  expect(mocks.prisma.trainingSession.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ attendees: { create: [{ userId: 3, trainingRequestId: 6 }] } }) }));
  mocks.prisma.trainingRequest.findMany.mockResolvedValue([]);
  expect((await create(req('POST', { ...createBody, attendeeUserIds: [3], requestAssignments: [assignment] }))).status).toBe(404);
  mocks.prisma.trainingRequest.findMany.mockResolvedValue([{ ...requestRow, userId: 7 }]);
  expect((await create(req('POST', { ...createBody, attendeeUserIds: [3], requestAssignments: [assignment] }))).status).toBe(409);
});
it.each([[{ userId: 3, trainingRequestId: '6' }], [{ userId: 4, trainingRequestId: 6 }], [{ userId: 3, trainingRequestId: 6 }, { userId: 3, trainingRequestId: 7 }], [{ userId: 3, trainingRequestId: 6, extra: true }]].map(requestAssignments => ({ requestAssignments })))('rejects malformed explicit assignments %j', async ({ requestAssignments }) => {
  expect((await create(req('POST', { ...createBody, attendeeUserIds: [3], requestAssignments }))).status).toBe(422);
});
it('releases a cancelled previous attendance before attaching an explicitly selected request', async () => {
  mocks.prisma.trainingRequest.findMany.mockResolvedValue([{ id: 6, userId: 3, trainingId: 2, status: 'approved', sessionAttendee: { id: 8, sessionId: 9, status: 'cancelled', session: { status: 'scheduled' } } }]);
  const response = await create(req('POST', { ...createBody, attendeeUserIds: [3], requestAssignments: [{ userId: 3, trainingRequestId: 6 }] })); expect(response.status).toBe(201);
  expect(mocks.prisma.trainingSessionAttendee.updateMany).toHaveBeenCalledWith({ where: { id: 8, trainingRequestId: 6 }, data: { trainingRequestId: null, reminder24hSentAt: null } });
});
