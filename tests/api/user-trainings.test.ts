import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => {
 const methods = () => ({ findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn(), create: vi.fn(), createMany: vi.fn(), update: vi.fn(), updateMany: vi.fn(), delete: vi.fn() });
 return { session: vi.fn(), publish: vi.fn(), prisma: { user: methods(), userPermission: methods(), botToken: methods(), training: methods(), trainingRequest: methods(), trainingRequestMessage: methods(), trainingSessionAttendee: methods(), userTraining: methods(), userTrainingStatusHistory: methods(), orbat: methods(), slot: methods(), signup: methods(), message: methods(), messageRecipient: methods(), apiAuditLog: methods(), $transaction: vi.fn() } };
});
vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }));
vi.mock('next-auth', () => ({ getServerSession: mocks.session }));
vi.mock('@/app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
vi.mock('@/lib/realtime/training-chat-events', () => ({ publishTrainingChatEvent: mocks.publish }));
vi.mock('@/lib/realtime/user-events', () => ({ publishUserProfileEvent: mocks.publish }));
vi.mock('@/lib/realtime/inbox-events', () => ({ publishInboxEvents: mocks.publish }));
import { GET as list, POST as create, PATCH as bulk } from '@/app/api/user-trainings/route';
import { PATCH as update, DELETE as remove } from '@/app/api/user-trainings/[id]/route';
import { GET as qualification } from '@/app/api/orbats/[id]/qualifications/route';
import { parseCredentialInput } from '@/lib/api/user-trainings';
const stamp = new Date('2026-09-18T00:00:00Z');
const user = { id: 3, username: 'Member', avatarUrl: null };
const training = { id: 2, name: 'Training', requiresTrainingSession: false, requiresOrbatQualification: true };
const initial = () => ({ id: 1, userId: 3, trainingId: 2, status: 'needs_qualify', notes: 'Private note', isHidden: false, trainerId: 1, statusUpdatedAt: stamp, trainingSessionCompletedAt: stamp, orbatQualifiedAt: null, failedAt: null, training, user, trainer: { ...user, id: 1 }, statusHistory: [{ id: 8, changedById: 1, changedBy: { ...user, id: 1 } }] });
let row: ReturnType<typeof initial>; let created: boolean;
const req = (method = 'GET', body?: unknown, query = '', bot = false) => new Request(`http://localhost/api/user-trainings${query}`, { method, headers: { 'content-type': 'application/json', ...(bot ? { authorization: 'Bearer token' } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const ctx = (id = '1') => ({ params: Promise.resolve({ id }) });
const payload = { userId: 3, trainingId: 2, status: 'needs_qualify' };
beforeEach(() => {
 vi.resetAllMocks(); row = initial(); created = false;
 mocks.session.mockResolvedValue({ user: { id: '1' } }); mocks.prisma.botToken.findFirst.mockResolvedValue({ id: 9 });
 mocks.prisma.user.findUnique.mockImplementation(async ({ where }) => ({ ...user, id: where.id, userPermissions: [{ permission: { key: 'training:mark' }, value: 2 }] })); mocks.prisma.userPermission.findMany.mockResolvedValue([]);
 mocks.prisma.training.findUnique.mockResolvedValue(training); mocks.prisma.userTraining.findUnique.mockImplementation(async ({ where }) => where.id || created ? structuredClone(row) : null); mocks.prisma.userTraining.findMany.mockResolvedValue([row]);
 mocks.prisma.userTraining.create.mockImplementation(async ({ data }) => { created = true; Object.assign(row, data); return row; }); mocks.prisma.userTraining.updateMany.mockImplementation(async ({ data }) => { Object.assign(row, data); return { count: 1 }; });
 mocks.prisma.trainingRequest.findFirst.mockResolvedValue(null); mocks.prisma.trainingRequest.findMany.mockResolvedValue([]); mocks.prisma.trainingRequest.updateMany.mockResolvedValue({ count: 1 });
 mocks.prisma.message.create.mockResolvedValue({ id: 11 }); mocks.prisma.$transaction.mockImplementation(work => work(mocks.prisma));
 mocks.prisma.orbat.findUnique.mockResolvedValue({ isSideOp: false }); mocks.prisma.slot.findMany.mockResolvedValue([{ id: 5, maxSignups: 2, squad: { name: 'Squad' }, squadRole: { name: 'Role', requiredTrainingIds: [2] }, _count: { signups: 0 } }]); mocks.prisma.signup.findMany.mockResolvedValue([]); mocks.prisma.signup.findFirst.mockResolvedValue({ id: 9 }); mocks.prisma.trainingSessionAttendee.count.mockResolvedValue(1);
});
const calls = [
 ['list', (bot = false) => list(req('GET', undefined, '', bot))], ['create', (bot = false) => create(req('POST', payload, '', bot))], ['bulk', (bot = false) => bulk(req('PATCH', { updates: [payload] }, '', bot))], ['update', (bot = false) => update(req('PATCH', { status: 'qualified' }, '', bot), ctx())], ['delete', (bot = false) => remove(req('DELETE', undefined, '', bot), ctx())], ['qualifications', (bot = false) => qualification(req('GET', undefined, '', bot), ctx())],
] as const;
it.each(calls)('%s accepts authenticated sessions and active bot tokens', async (_name, call) => { expect((await call()).status).toBeLessThan(300); created = false; row = initial(); expect((await call(true)).status).toBeLessThan(300); });
it.each(calls)('%s rejects no credentials and invalid bot without fallback', async (_name, call) => { mocks.session.mockResolvedValue(null); expect((await call()).status).toBe(401); mocks.session.mockResolvedValue({ user: { id: '1' } }); mocks.prisma.botToken.findFirst.mockResolvedValue(null); expect((await call(true)).status).toBe(401); });
it.each(calls.filter(([name]) => name !== 'list'))('%s denies nonstaff', async (_name, call) => { mocks.prisma.user.findUnique.mockResolvedValue({ ...user, id: 1, userPermissions: [] }); expect((await call()).status).toBe(403); });
it.each(['?unknown=1','?limit=0','?limit=101','?limit=1&limit=2','?cursor=2147483648','?status=unknown','?userId=0','?trainingId=abc'])('rejects collection query %s', async query => { expect((await list(req('GET', undefined, query))).status).toBe(400); });
it('scopes members before paging and redacts hidden staff identity from histories', async () => {
 mocks.session.mockResolvedValue({ user: { id: '3' } }); mocks.prisma.user.findUnique.mockResolvedValue({ ...user, userPermissions: [] }); row.status = 'approved';
 const data = (await (await list(req())).json()).data[0]; expect(data.trainer).toBeNull(); expect(data.statusHistory[0].changedBy).toBeNull(); expect(mocks.prisma.userTraining.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 3, isHidden: false } })); expect(mocks.prisma.apiAuditLog.create).not.toHaveBeenCalled();
 expect((await list(req('GET', undefined, '?userId=4'))).status).toBe(403);
});
it('uses real lookahead and excludes hidden page identities from audit', async () => {
 mocks.prisma.userTraining.findMany.mockResolvedValue([row, { ...row, id: 2, userId: 99 }]); const data = await (await list(req('GET', undefined, '?limit=1&cursor=7&trainingId=2&status=needs_qualify'))).json(); expect(data.meta).toEqual({ limit: 1, nextCursor: '1' }); expect(mocks.prisma.apiAuditLog.create.mock.calls[0][0].data.targetUserIds).toEqual([3]);
 mocks.prisma.userTraining.findMany.mockResolvedValue([]); mocks.prisma.apiAuditLog.create.mockClear(); expect((await (await list(req())).json()).meta.nextCursor).toBeNull(); expect(mocks.prisma.apiAuditLog.create).not.toHaveBeenCalled();
});
it.each([null, [], {}, { userId: '3', trainingId: 2 }, { userId: 3, trainingId: 2, needsRetraining: true }, { userId: 3, trainingId: 2, isHidden: 1 }, { userId: 3, trainingId: 2, notes: 'x'.repeat(4001) }, { userId: 3, trainingId: 2, status: 'bad' }].map(body => ({ body })))('validates strict create body $body', async ({ body }) => { expect((await create(req('POST', body))).status).toBe(422); expect(mocks.prisma.userTraining.create).not.toHaveBeenCalled(); });
it.each([{}, { extra: true }, { trainingSessionId: '3' }, { orbatId: 0 }, { notes: 4 }, { isHidden: null }].map(body => ({ body })))('validates strict update body $body', async ({ body }) => { expect((await update(req('PATCH', body), ctx())).status).toBe(422); });
it('normalizes notes and preserves omitted state on partial changes', async () => {
 expect(parseCredentialInput({ notes: '  ' }, false)).toEqual({ notes: null }); expect(parseCredentialInput({ notes: ' text ', trainingSessionId: null }, false)).toEqual({ notes: 'text', trainingSessionId: null });
 await update(req('PATCH', { isHidden: true }), ctx()); expect(mocks.prisma.userTraining.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ notes: 'Private note', status: 'needs_qualify', isHidden: true }) })); expect(mocks.prisma.userTrainingStatusHistory.create).not.toHaveBeenCalled();
});
it('enforces missing references, hierarchy, duplicate assignment and configuration', async () => {
 created = true; expect((await create(req('POST', payload))).status).toBe(409); created = false;
 mocks.prisma.training.findUnique.mockResolvedValue(null); expect((await create(req('POST', payload))).status).toBe(404); mocks.prisma.training.findUnique.mockResolvedValue({ ...training, requiresOrbatQualification: false }); expect((await create(req('POST', payload))).status).toBe(409);
 mocks.prisma.userPermission.findMany.mockResolvedValue([{ value: 3, permission: { key: 'training:mark' } }]); expect((await update(req('PATCH', { notes: 'x' }), ctx())).status).toBe(403);
});
it('validates qualification context and session provenance before writes', async () => {
 mocks.prisma.trainingSessionAttendee.count.mockResolvedValue(0); expect((await update(req('PATCH', { status: 'qualified', trainingSessionId: 4 }), ctx())).status).toBe(409);
 mocks.prisma.orbat.findUnique.mockResolvedValue(null); expect((await update(req('PATCH', { status: 'qualified', orbatId: 4 }), ctx())).status).toBe(404);
 mocks.prisma.orbat.findUnique.mockResolvedValue({ isSideOp: true }); expect((await update(req('PATCH', { status: 'qualified', orbatId: 4 }), ctx())).status).toBe(409);
 mocks.prisma.orbat.findUnique.mockResolvedValue({ isSideOp: false }); mocks.prisma.signup.findFirst.mockResolvedValue(null); expect((await update(req('PATCH', { status: 'qualified', orbatId: 4 }), ctx())).status).toBe(409);
});
it('preserves workflow history and linked request updates atomically, handling races', async () => {
 mocks.prisma.trainingRequest.findFirst.mockResolvedValue({ id: 7, status: 'needs_qualify' }); const response = await update(req('PATCH', { status: 'qualified', orbatId: 4, notes: 'Evaluation' }), ctx()); expect(response.status).toBe(200); expect(mocks.prisma.trainingRequestMessage.create).toHaveBeenCalledWith({ data: { requestId: 7, senderRole: 'SYSTEM', body: 'ORBAT qualification passed: Evaluation' } }); expect(JSON.stringify(mocks.prisma.apiAuditLog.create.mock.calls)).not.toContain('Evaluation');
 row = initial(); mocks.prisma.trainingRequest.updateMany.mockResolvedValue({ count: 0 }); expect((await update(req('PATCH', { status: 'qualified' }), ctx())).status).toBe(409);
 row = initial(); mocks.prisma.userTraining.updateMany.mockResolvedValue({ count: 0 }); expect((await update(req('PATCH', { status: 'qualified' }), ctx())).status).toBe(409);
});
it.each([{ updates: [] }, { updates: Array.from({ length: 101 }, () => payload) }, { updates: [payload,payload] }, { updates: [{ ...payload, status: 'qualified' }] }, { updates: [payload], extra: true }])('rejects invalid bulk updates %j', async body => { expect((await bulk(req('PATCH', body))).status).toBe(422); });
it('validates IDs, JSON, mutation query and delete body', async () => {
 expect((await update(req('PATCH', { notes: null }), ctx('0'))).status).toBe(400); expect((await remove(req('DELETE', { body: true }), ctx())).status).toBe(400); expect((await create(req('POST', payload, '?x=1'))).status).toBe(400); expect((await create(new Request('http://localhost', { method: 'POST', body: '{' }))).status).toBe(400);
});
it('propagates audit failure and database races while tolerating postcommit notification failure', async () => {
 mocks.publish.mockImplementation(() => { throw new Error('offline'); }); expect((await update(req('PATCH', { status: 'qualified' }), ctx())).status).toBe(200);
 mocks.prisma.apiAuditLog.create.mockRejectedValue(new Error('audit')); expect((await remove(req('DELETE'), ctx())).status).toBe(500);
 mocks.prisma.$transaction.mockRejectedValue({ code: 'P2034' }); expect((await create(req('POST', payload))).status).toBe(409);
});
it('qualifications paginate credential rows and expose existing signup IDs without private signup fields', async () => {
 mocks.prisma.userTraining.findMany.mockResolvedValue([row, { ...row, id: 2 }]); mocks.prisma.signup.findMany.mockResolvedValue([{ id: 8, userId: 3, slotId: 5, slot: { squadRole: { name: 'Role', requiredTrainingIds: [2] }, squad: { name: 'Squad' } } }]);
 const page = await (await qualification(req('GET', undefined, '?limit=1'), ctx())).json(); expect(page.meta.nextCursor).toBe('1'); expect(page.data.groups[0].users[0]).toMatchObject({ existingSignupId: 8, assignedSlot: { signupId: 8 } });
 mocks.prisma.slot.findMany.mockResolvedValue([]); expect((await (await qualification(req(), ctx())).json()).data.groups).toEqual([]);
});
it('qualification query rejects missing/side operations and invalid query', async () => {
 expect((await qualification(req('GET', undefined, '?foo=1'), ctx())).status).toBe(400); mocks.prisma.orbat.findUnique.mockResolvedValue(null); expect((await qualification(req(), ctx())).status).toBe(404); mocks.prisma.orbat.findUnique.mockResolvedValue({ isSideOp: true }); expect((await qualification(req(), ctx())).status).toBe(409);
});
it('ORBAT qualification paging validates limits and shows only relevant occupied and available slots', async () => {
  expect((await qualification(req('GET', undefined, '?limit=101'), ctx())).status).toBe(400);
  const slot = { id: 5, maxSignups: null, squad: { name: 'Alpha' }, squadRole: { name: 'Medic', requiredTrainingIds: [2, 7] }, _count: { signups: 10 } };
  mocks.prisma.slot.findMany.mockResolvedValue([slot, { ...slot, id: 6, maxSignups: 1 }, { ...slot, id: 7, squadRole: null }]);
  mocks.prisma.userTraining.findMany.mockResolvedValue([row, { ...row, id: 2 }]);
  mocks.prisma.signup.findMany.mockResolvedValue([{ id: 9, userId: 3, slotId: 5, slot }]);
  const body = await (await qualification(req('GET', undefined, '?limit=1&cursor=8'), ctx())).json();
  expect(body.meta).toEqual({ limit: 1, nextCursor: '1' });
  expect(body.data.groups).toHaveLength(1);
  expect(body.data.groups[0].availableSlots).toEqual([{ id: 5, label: 'Alpha — Medic', remainingCapacity: null }]);
  expect(body.data.groups[0].users[0].assignedSlot).toEqual({ signupId: 9, slotId: 5, slotName: 'Medic', squadName: 'Alpha' });
  mocks.prisma.signup.findMany.mockResolvedValue([{ id: 9, userId: 3, slotId: 5, slot: { ...slot, squadRole: null } }]);
  expect((await (await qualification(req(), ctx())).json()).data.groups[0].users[0].assignedSlot).toBeNull();
});
it('self-only qualification reads do not create other-user read audits', async () => {
  row.userId = 1;
  expect((await qualification(req(), ctx())).status).toBe(200);
  expect(mocks.prisma.apiAuditLog.create).not.toHaveBeenCalled();
});
it('credential lookup failures and mutation transport errors return canonical responses', async () => {
  expect((await create(req('POST', payload, '?x=1'))).status).toBe(400);
  expect((await remove(req('DELETE', {}), ctx())).status).toBe(400);
  mocks.prisma.userTraining.findUnique.mockResolvedValue(null);
  expect((await update(req('PATCH', { notes: null }), ctx())).status).toBe(404);
  expect((await remove(req('DELETE'), ctx())).status).toBe(404);
  mocks.prisma.training.findUnique.mockResolvedValue(null);
  expect((await create(req('POST', payload))).status).toBe(404);
});
it('credential assignment validates session references and ORBAT scope before changes', async () => {
  mocks.prisma.trainingSessionAttendee.count.mockResolvedValue(0);
  expect((await update(req('PATCH', { trainingSessionId: 9, status: 'qualified' }), ctx())).status).toBe(409);
  mocks.prisma.orbat.findUnique.mockResolvedValue(null);
  expect((await update(req('PATCH', { orbatId: 9, status: 'qualified' }), ctx())).status).toBe(404);
  mocks.prisma.orbat.findUnique.mockResolvedValue({ isSideOp: true });
  expect((await update(req('PATCH', { orbatId: 9, status: 'qualified' }), ctx())).status).toBe(409);
});
it('changed or deleted credentials and related requests are detected atomically', async () => {
  mocks.prisma.userTraining.findUnique.mockResolvedValueOnce(row).mockResolvedValueOnce(null);
  expect((await update(req('PATCH', { notes: 'Updated' }), ctx())).status).toBe(409);
  mocks.prisma.userTraining.findUnique.mockResolvedValue(row);
  mocks.prisma.trainingRequest.findFirst.mockResolvedValue({ id: 7, status: 'needs_qualify' });
  mocks.prisma.trainingRequest.updateMany.mockResolvedValue({ count: 0 });
  expect((await update(req('PATCH', { status: 'qualified' }), ctx())).status).toBe(409);
});
it.each(['qualified', 'failed'])('ORBAT qualification %s synchronizes its related request and recorded notes', async status => {
  mocks.prisma.trainingRequest.findFirst.mockResolvedValue({ id: 7, status: 'needs_qualify' });
  expect((await update(req('PATCH', { status, orbatId: 9, notes: status === 'qualified' ? 'Passed in mission' : null }), ctx())).status).toBe(200);
  expect(mocks.prisma.trainingRequestMessage.create).toHaveBeenCalledWith({ data: { requestId: 7, senderRole: 'SYSTEM', body: status === 'qualified' ? 'ORBAT qualification passed: Passed in mission' : 'ORBAT qualification failed.' } });
});
it('credential notifications handle theoretical session progress without granting qualification', async () => {
  row.training = { ...training, requiresTrainingSession: true, requiresOrbatQualification: false }; row.status = 'approved';
  expect((await update(req('PATCH', { status: 'in_training' }), ctx())).status).toBe(200);
  expect(mocks.prisma.message.create).toHaveBeenCalledWith({ data: expect.objectContaining({ body: 'Your Training status is now in training.' }) });
});
it('credential lists support the current user alias and explicit request links', async () => {
  expect((await list(req('GET', undefined, '?userId=me', true))).status).toBe(400);
  mocks.prisma.trainingRequest.findMany.mockResolvedValue([{ id: 10, userId: 99, trainingId: 2 }, { id: 11, userId: 3, trainingId: 2 }]);
  expect((await (await list(req())).json()).data[0].relatedRequestId).toBe(11);
  expect((await list(req('GET', undefined, '?userId=me'))).status).toBe(200);
});
it('credential writes reject absent users and transitions which skip required training', async () => {
  mocks.prisma.user.findUnique.mockResolvedValueOnce({ ...user, userPermissions: [{ permission: { key: 'training:mark' }, value: 2 }] }).mockResolvedValueOnce(null);
  expect((await create(req('POST', payload))).status).toBe(404);
  row.status = 'approved'; row.training = { ...training, requiresTrainingSession: true };
  expect((await update(req('PATCH', { status: 'qualified' }), ctx())).status).toBe(409);
  expect((await update(req('PATCH', { status: 'finished' }), ctx())).status).toBe(409);
});
it('new credentials default to qualified with a completed-session timestamp', async () => {
  expect((await create(req('POST', { userId: 3, trainingId: 2 }))).status).toBe(201);
  expect(mocks.prisma.userTraining.create).toHaveBeenCalledWith({ data: expect.objectContaining({ status: 'qualified', trainingSessionCompletedAt: expect.any(Date) }) });
});
it('non-ORBAT progress synchronizes its request and emits a lifecycle notification', async () => {
  row.status = 'approved'; row.training = { ...training, requiresTrainingSession: true, requiresOrbatQualification: false };
  mocks.prisma.trainingRequest.findFirst.mockResolvedValue({ id: 7, status: 'approved' });
  expect((await update(req('PATCH', { status: 'in_training' }), ctx())).status).toBe(200);
  expect(mocks.prisma.trainingRequestMessage.create).toHaveBeenCalledWith({ data: { requestId: 7, senderRole: 'SYSTEM', body: 'Training status changed from approved to in_training.' } });
});
it('a principal without training rights cannot enumerate credentials using a bot identity', async () => {
  const { listCredentials } = await import('@/lib/api/user-trainings');
  const principal = { kind: 'bot' as const, tokenId: 9, permissions: {} };
  await expect(listCredentials(req(), principal, {} as never)).rejects.toThrow('Only your own credentials');
});
it('progressing a record with no session completion retains a null timestamp', async () => {
  row.status = 'approved'; row.training = { ...training, requiresTrainingSession: true };
  row.trainingSessionCompletedAt = null as unknown as Date;
  expect((await update(req('PATCH', { status: 'in_training' }), ctx())).status).toBe(200);
  expect(mocks.prisma.userTraining.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ trainingSessionCompletedAt: null }) }));
});
