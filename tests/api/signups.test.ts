import { beforeEach, expect, test, vi } from 'vitest';
const mocks = vi.hoisted(() => { const model = () => ({ findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), upsert: vi.fn(), delete: vi.fn(), deleteMany: vi.fn() }); return { session: vi.fn(), publish: vi.fn(), db: { user: model(), userPermission: model(), botToken: model(), orbat: model(), slot: model(), signup: model(), orbatAttendanceNote: model(), training: model(), userTraining: model(), rank: model(), userRank: model(), botEvent: model(), botIdempotencyReceipt: model(), apiAuditLog: model(), $transaction: vi.fn() } }; });
vi.mock('@/lib/prisma', () => ({ prisma: mocks.db }));
vi.mock('next-auth', () => ({ getServerSession: mocks.session }));
vi.mock('@/app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
vi.mock('@/lib/realtime/orbat-events', () => ({ publishOrbatEvent: mocks.publish }));
import { POST } from '@/app/api/signups/route';
import { PATCH, DELETE } from '@/app/api/signups/[id]/route';
import { GET as signups } from '@/app/api/orbats/[id]/signups/route';
import { GET as userSignups } from '@/app/api/users/[id]/signups/route';
import { GET as eligibility } from '@/app/api/orbats/[id]/eligibility/route';
import { GET as available } from '@/app/api/orbats/[id]/available-slots/route';
import { GET as noteGet, PATCH as notePatch, DELETE as noteDelete } from '@/app/api/orbats/[id]/availability/[userId]/route';
const ctx = (id = '20') => ({ params: Promise.resolve({ id }) });
const noteCtx = (userId = 'me') => ({ params: Promise.resolve({ id: '20', userId }) });
const req = (method: string, body?: unknown, query = '', headers: Record<string, string> = {}) => new Request(`http://localhost/api/test${query}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const operation = () => ({ id: 20, name: 'Operation', isSideOp: false, startsAtUtc: new Date('2099-01-01T00:00:00Z'), endsAtUtc: null, eventDate: null, startTime: null, endTime: null });
const slot = () => ({ id: 21, orbatId: 20, squadId: 22, orderIndex: 0, maxSignups: 2, _count: { signups: 0 }, orbat: operation(), squad: { id: 22, name: 'Squad' }, squadRole: { name: 'Role', requiredTrainingIds: [], requiredRankIds: [] } });
const signup = () => ({ id: 30, userId: 4, slotId: 21, createdAt: new Date('2020-01-01T00:00:00Z'), slot: { orbatId: 20 }, attendance: null });
const note = () => ({ id: 40, orbatId: 20, userId: 4, status: 'unsure', reason: 'Private reason', lateMinutes: null, leaveEarlyMinutes: null, createdAt: new Date('2020-01-01T00:00:00Z'), updatedAt: new Date('2020-01-01T00:00:00Z') });
beforeEach(() => {
  vi.resetAllMocks(); mocks.session.mockResolvedValue({ user: { id: 4 } });
  mocks.db.user.findUnique.mockResolvedValue({ id: 4, userPermissions: [{ permission: { key: 'orbat:edit' }, value: 2 }] });
  mocks.db.userPermission.findMany.mockResolvedValue([]); mocks.db.botToken.findFirst.mockResolvedValue({ id: 9 });
  mocks.db.slot.findUnique.mockResolvedValue(slot()); mocks.db.slot.findMany.mockResolvedValue([slot()]); mocks.db.orbat.findUnique.mockResolvedValue(operation());
  mocks.db.signup.findUnique.mockResolvedValue(signup()); mocks.db.signup.create.mockImplementation(async ({ data }) => ({ ...signup(), ...data })); mocks.db.signup.update.mockImplementation(async ({ data }) => ({ ...signup(), ...data })); mocks.db.signup.findMany.mockResolvedValue([]);
  mocks.db.orbatAttendanceNote.findUnique.mockResolvedValue(null); mocks.db.orbatAttendanceNote.upsert.mockImplementation(async ({ update }) => ({ ...note(), ...update }));
  mocks.db.training.findMany.mockResolvedValue([]); mocks.db.userTraining.findMany.mockResolvedValue([]); mocks.db.rank.findMany.mockResolvedValue([]);
  mocks.db.$transaction.mockImplementation(async cb => cb(mocks.db));
});
const methods = [
  ['create', () => POST(req('POST', { slotId: 21 }))], ['move', () => PATCH(req('PATCH', { slotId: 21 }), ctx('30'))], ['delete', () => DELETE(req('DELETE'), ctx('30'))],
  ['orbat-list', () => signups(req('GET'), ctx())], ['user-list', () => userSignups(req('GET'), ctx('me'))], ['eligibility', () => eligibility(req('GET'), ctx())],
  ['availability-get', () => noteGet(req('GET'), noteCtx())], ['availability-patch', () => notePatch(req('PATCH', { status: 'unsure' }), noteCtx())], ['availability-delete', () => noteDelete(req('DELETE'), noteCtx())],
] as const;
test.each(methods)('%s requires authentication', async (_name, call) => { mocks.session.mockResolvedValue(null); expect((await call()).status).toBe(401); });
test('create allows self without staff permission, live bot numeric targets and forbids bad tokens/hierarchy', async () => {
  mocks.db.user.findUnique.mockResolvedValue({ id: 4, userPermissions: [] });
  expect((await POST(req('POST', { slotId: 21 }))).status).toBe(201);
  expect((await POST(req('POST', { slotId: 21, userId: 5 }))).status).toBe(403);
  expect((await POST(req('POST', { slotId: 21, userId: 5 }, '', { authorization: 'Bearer valid' }))).status).toBe(201);
  expect((await POST(req('POST', { slotId: 21 }, '', { authorization: 'Bearer valid' }))).status).toBe(400);
  mocks.db.botToken.findFirst.mockResolvedValue(null);
  expect((await POST(req('POST', { slotId: 21 }, '', { authorization: 'Bearer revoked' }))).status).toBe(401);
  expect((await POST(req('POST', { slotId: 21 }, '', { authorization: 'Basic invalid' }))).status).toBe(401);
});
test.each([{}, null, [], { slotId: '21' }, { slotId: 2147483648 }, { slotId: 21, discordUserId: 'legacy' }, { slotId: 21, userId: '5' }, { slotId: 21, overrideRequirements: true }])('create strict payload %#', async body => { expect((await POST(req('POST', body))).status).toBe(422); expect(mocks.db.signup.create).not.toHaveBeenCalled(); });
test('validates malformed JSON query paths headers and move override boolean', async () => {
  expect((await POST(new Request('http://localhost/api/signups', { method: 'POST', body: '{' }))).status).toBe(400);
  expect((await POST(req('POST', { slotId: 21 }, '?legacy=1'))).status).toBe(400);
  expect((await PATCH(req('PATCH', { slotId: 21 }), ctx('abc'))).status).toBe(400);
  expect((await PATCH(req('PATCH', { slotId: 21, overrideRequirements: 'true' }), ctx())).status).toBe(422);
  expect((await POST(req('POST', { slotId: 21 }, '', { 'idempotency-key': 'x'.repeat(201) }))).status).toBe(400);
});
test('mutation snapshots and outbox use same serializable transaction and minimal UTC DTO', async () => {
  const response = await POST(req('POST', { slotId: 21 }));
  expect(await response.json()).toEqual({ data: { id: 30, slotId: 21, userId: 4, orbatId: 20, createdAt: '2020-01-01T00:00:00.000Z' }, meta: { warnings: [] } });
  expect(mocks.db.$transaction.mock.lastCall![1]).toEqual({ isolationLevel: 'Serializable' });
  expect(mocks.publish.mock.lastCall![0].payload).not.toHaveProperty('userId');
  expect(mocks.db.botEvent.create.mock.lastCall![0].data).toMatchObject({ type: 'orbat.signup_changed', aggregateId: '20', payload: { userId: 4, oldSlotId: null, slotId: 21 } });
  expect(mocks.db.apiAuditLog.create.mock.lastCall![0].data).toMatchObject({ action: 'signup.created', targetUserIds: [4] });
});
test.each([['closed', 'signup_closed'], ['absent', 'marked_absent'], ['full', 'slot_full'], ['duplicate', 'already_signed_up']] as const)('enforces %s inside transaction', async (scenario, code) => {
  if (scenario === 'closed') mocks.db.slot.findUnique.mockResolvedValue({ ...slot(), orbat: { ...operation(), startsAtUtc: new Date('2000-01-01T00:00:00Z') } });
  if (scenario === 'absent') mocks.db.orbatAttendanceNote.findUnique.mockResolvedValue({ status: 'absent' });
  if (scenario === 'full') mocks.db.slot.findUnique.mockResolvedValue({ ...slot(), _count: { signups: 2 } });
  if (scenario === 'duplicate') mocks.db.signup.findFirst.mockResolvedValue({ id: 99 });
  const response = await POST(req('POST', { slotId: 21 })); expect(response.status).toBe(409); expect((await response.json()).error.code).toBe(code); expect(mocks.db.signup.create).not.toHaveBeenCalled();
});
test('rank/training checks, temporary qualification and sideop rules share the evaluator', async () => {
  mocks.db.slot.findUnique.mockResolvedValue({ ...slot(), squadRole: { name: 'R', requiredTrainingIds: [7], requiredRankIds: [8] } });
  expect((await POST(req('POST', { slotId: 21 }))).status).toBe(409);
  mocks.db.rank.findMany.mockResolvedValue([{ id: 8, orderIndex: 2 }]); mocks.db.userRank.findUnique.mockResolvedValue({ currentRank: { orderIndex: 2 } });
  let response = await POST(req('POST', { slotId: 21 })); expect((await response.json()).error.code).toBe('training_required');
  mocks.db.training.findMany.mockResolvedValue([{ id: 7, name: 'T', requiresOrbatQualification: true }]); mocks.db.userTraining.findMany.mockResolvedValue([{ trainingId: 7, status: 'needs_qualify' }]);
  expect((await POST(req('POST', { slotId: 21 }))).status).toBe(201);
  mocks.db.slot.findUnique.mockResolvedValue({ ...slot(), orbat: { ...operation(), isSideOp: true }, squadRole: { name: 'R', requiredTrainingIds: [999], requiredRankIds: [999] } });
  expect((await POST(req('POST', { slotId: 21 }))).status).toBe(201);
});
test('staff explicit overrides warn but never bypass capacity absence or cross-operation', async () => {
  mocks.db.slot.findUnique.mockResolvedValue({ ...slot(), squadRole: { name: 'R', requiredTrainingIds: [7], requiredRankIds: [8] } });
  const response = await PATCH(req('PATCH', { slotId: 21, overrideRequirements: true }), ctx('30')); expect(response.status).toBe(200); expect((await response.json()).meta.warnings).toHaveLength(2);
  mocks.db.slot.findUnique.mockResolvedValue({ ...slot(), orbatId: 99 }); expect((await PATCH(req('PATCH', { slotId: 21, overrideRequirements: true }), ctx('30'))).status).toBe(409);
  mocks.db.user.findUnique.mockResolvedValue({ id: 4, userPermissions: [] }); expect((await PATCH(req('PATCH', { slotId: 21 }), ctx('30'))).status).toBe(403);
});
test('missing references and signup return404, delete audits cascading record IDs', async () => {
  mocks.db.slot.findUnique.mockResolvedValue(null); expect((await POST(req('POST', { slotId: 21 }))).status).toBe(404);
  mocks.db.slot.findUnique.mockResolvedValue(slot()); mocks.db.signup.findUnique.mockResolvedValue(null); expect((await DELETE(req('DELETE'), ctx('30'))).status).toBe(404);
  mocks.db.signup.findUnique.mockResolvedValue({ ...signup(), attendance: { id: 50, sessions: [{ id: 51 }], logs: [{ id: 52 }] } });
  expect((await DELETE(req('DELETE'), ctx('30'))).status).toBe(200);
  expect(mocks.db.apiAuditLog.create.mock.lastCall![0].data.before).toMatchObject({ attendanceId: 50, attendanceSessionIds: [51], attendanceLogIds: [52] });
});
test('idempotency is actor scoped, committed with mutation, replays no writes and rejects different payload', async () => {
  const headers = { 'idempotency-key': 'repeat' };
  expect((await POST(req('POST', { slotId: 21 }, '', headers))).status).toBe(201);
  const receipt = mocks.db.botIdempotencyReceipt.create.mock.lastCall![0].data;
  mocks.db.botIdempotencyReceipt.findUnique.mockResolvedValue(receipt);
  expect((await POST(req('POST', { slotId: 21 }, '', headers))).status).toBe(201); expect(mocks.db.signup.create).toHaveBeenCalledTimes(1);
  expect((await POST(req('POST', { slotId: 22 }, '', headers))).status).toBe(409);
  mocks.db.botIdempotencyReceipt.findUnique.mockResolvedValue({ ...receipt, expiresAt: new Date(0) });
  expect((await POST(req('POST', { slotId: 21 }, '', headers))).status).toBe(201); expect(mocks.db.botIdempotencyReceipt.delete).toHaveBeenCalled();
});
test('public availability is paginated count-only with explicit credential validation', async () => {
  mocks.session.mockResolvedValue(null); mocks.db.slot.findMany.mockResolvedValue([slot(), { ...slot(), id: 25 }]);
  const response = await available(req('GET', undefined, '?limit=1'), ctx()); expect(response.status).toBe(200);
  const body = await response.json(); expect(body.meta.nextCursor).toBe('21'); expect(body.data[0]).toEqual({ slotId: 21, slotName: 'Role', squadId: 22, squadName: 'Squad', capacity: 2, signupCount: 0, available: true });
  expect(mocks.db.apiAuditLog.create).not.toHaveBeenCalled(); mocks.db.botToken.findFirst.mockResolvedValue(null);
  expect((await available(req('GET', undefined, '', { authorization: 'Bearer bad' }), ctx())).status).toBe(401);
  expect((await available(req('GET', undefined, '?userId=4'), ctx())).status).toBe(400);
  expect((await available(req('GET'), ctx('bad'))).status).toBe(400);
});
test('eligibility returns training status and current signup and audits only targetedother reads', async () => {
  mocks.db.slot.findMany.mockResolvedValue([{ ...slot(), squadRole: { name: 'R', requiredTrainingIds: [7], requiredRankIds: [] } }]);
  mocks.db.training.findMany.mockResolvedValue([{ id: 7, name: 'T', requiresOrbatQualification: true }]); mocks.db.userTraining.findMany.mockResolvedValue([{ trainingId: 7, status: 'needs_qualify' }]); mocks.db.signup.findFirst.mockResolvedValue({ id: 30, slotId: 21 });
  const response = await eligibility(req('GET'), ctx()); const body = await response.json(); expect(body.data[0]).toMatchObject({ allowed: true, temporary: true, currentSignup: { id: 30, slotId: 21 } }); expect(mocks.db.apiAuditLog.create).not.toHaveBeenCalled();
  expect((await eligibility(req('GET', undefined, '?userId=5'), ctx())).status).toBe(200); expect(mocks.db.apiAuditLog.create.mock.lastCall![0].data.targetUserIds).toEqual([5]);
});
test('signup lists use actual descending lookahead with display-only user fields and privacy audit', async () => {
  const row = { ...signup(), userId: 5, user: { id: 5, username: 'Member' }, slot: { ...slot(), orbat: operation() } };
  mocks.db.signup.findMany.mockResolvedValue([row, { ...row, id: 29, userId: 6 }]);
  const response = await signups(req('GET', undefined, '?limit=1&cursor=31'), ctx()); const body = await response.json(); expect(body.meta.nextCursor).toBe('30'); expect(body.data[0].user).toEqual(row.user);
  expect(mocks.db.apiAuditLog.create.mock.lastCall![0].data.targetUserIds).toEqual([5]); expect(mocks.db.signup.findMany.mock.lastCall![0].where.id).toEqual({ lt: 31 });
  mocks.db.signup.findMany.mockResolvedValue([]); expect((await userSignups(req('GET'), ctx('5'))).status).toBe(200); expect(mocks.db.apiAuditLog.create.mock.lastCall![0].data.targetUserIds).toEqual([5]);
  expect((await signups(req('GET', undefined, '?cursor=1&cursor=2'), ctx())).status).toBe(400);
});
test.each([{ status: 'bad' }, { status: 'unsure', userId: 5 }, { status: 'late_unsure' }, { status: 'late_unsure', lateMinutes: '3' }, { status: 'unsure', reason: 42 }, { status: 'unsure', reason: 'x'.repeat(501) }])('availability strict fields %#', async body => { expect((await notePatch(req('PATCH', body), noteCtx())).status).toBe(422); });
test('availability upsert/read/delete consistent DTO with reason redaction and other-read audit', async () => {
  const saved = await notePatch(req('PATCH', { status: 'late_unsure', reason: ' Private reason ', lateMinutes: 0 }), noteCtx()); expect(saved.status).toBe(200); expect((await saved.json()).data.createdAt).toBe('2020-01-01T00:00:00.000Z');
  expect(mocks.db.apiAuditLog.create.mock.lastCall![0].data.after.reason).toBe('[REDACTED]');
  mocks.db.orbatAttendanceNote.findUnique.mockResolvedValue(note()); expect((await noteGet(req('GET'), noteCtx('5'))).status).toBe(200);
  expect(mocks.db.apiAuditLog.create.mock.lastCall![0].data).toMatchObject({ action: 'user_data.read', targetUserIds: [5] });
  expect(await (await noteDelete(req('DELETE'), noteCtx())).json()).toEqual({ data: null, meta: {} });
});
test.each(['P2002', 'P2003', 'P2034', 'P2025'])('database error %s is normalized', async code => { mocks.db.$transaction.mockRejectedValue({ code }); expect((await POST(req('POST', { slotId: 21 }))).status).toBe(code === 'P2025' ? 404 : 409); });
test('audit/outbox failures fail closed and realtime failure preserves committed success', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {}); mocks.db.apiAuditLog.create.mockRejectedValue(new Error('audit failed'));
  expect((await POST(req('POST', { slotId: 21 }))).status).toBe(500); expect(mocks.publish).not.toHaveBeenCalled();
  expect((await eligibility(req('GET', undefined, '?userId=5'), ctx())).status).toBe(500);
  mocks.db.apiAuditLog.create.mockResolvedValue({}); mocks.db.botEvent.create.mockRejectedValue(new Error('outbox failed')); expect((await DELETE(req('DELETE'), ctx('30'))).status).toBe(500);
  mocks.db.botEvent.create.mockResolvedValue({}); mocks.publish.mockImplementation(() => { throw new Error('listener'); }); expect((await POST(req('POST', { slotId: 21 }))).status).toBe(201);
  expect((await notePatch(req('PATCH', { status: 'unsure' }), noteCtx())).status).toBe(200); log.mockRestore();
});

test('qualification assignment grants narrowly scoped training staff authority and preserves normal guards', async () => {
  mocks.db.user.findUnique.mockResolvedValue({ id: 4, userPermissions: [{ permission: { key: 'training:mark' }, value: 2 }] });
  mocks.db.userTraining.findUnique.mockResolvedValue({ status: 'needs_qualify' });
  mocks.db.slot.findUnique.mockResolvedValue({ ...slot(), squadRole: { name: 'R', requiredTrainingIds: [7], requiredRankIds: [] } });
  mocks.db.training.findMany.mockResolvedValue([{ id: 7, name: 'Training', requiresOrbatQualification: true }]); mocks.db.userTraining.findMany.mockResolvedValue([{ trainingId: 7, status: 'needs_qualify' }]);
  expect((await POST(req('POST', { slotId: 21, userId: 5, qualificationTrainingId: 7 }))).status).toBe(201);
  expect((await PATCH(req('PATCH', { slotId: 21, qualificationTrainingId: 7 }), ctx('30'))).status).toBe(200);
  expect((await PATCH(req('PATCH', { slotId: 21, qualificationTrainingId: 7, overrideRequirements: true }), ctx('30'))).status).toBe(422);
  mocks.db.orbatAttendanceNote.findUnique.mockResolvedValue({ status: 'absent' }); expect((await POST(req('POST', { slotId: 21, userId: 5, qualificationTrainingId: 7 }))).status).toBe(409);
});
test('qualification assignment rejects wrong state, role, side operation and target hierarchy', async () => {
  mocks.db.user.findUnique.mockResolvedValue({ id: 4, userPermissions: [{ permission: { key: 'training:mark' }, value: 2 }] });
  const body = { slotId: 21, userId: 5, qualificationTrainingId: 7 };
  expect((await POST(req('POST', { ...body, qualificationTrainingId: '7' }))).status).toBe(422);
  mocks.db.userTraining.findUnique.mockResolvedValue({ status: 'qualified' }); expect((await POST(req('POST', body))).status).toBe(409);
  mocks.db.userTraining.findUnique.mockResolvedValue({ status: 'needs_qualify' }); expect((await POST(req('POST', body))).status).toBe(409);
  mocks.db.slot.findUnique.mockResolvedValue({ ...slot(), orbat: { ...operation(), isSideOp: true }, squadRole: { requiredTrainingIds: [7] } }); expect((await POST(req('POST', body))).status).toBe(409);
  mocks.db.userPermission.findMany.mockResolvedValue([{ value: 3, permission: { key: 'training:mark' } }]); expect((await POST(req('POST', body))).status).toBe(403);
});
test('qualification idempotency replay revalidates live authority and qualifying credential', async () => {
  mocks.db.user.findUnique.mockResolvedValue({ id: 4, userPermissions: [{ permission: { key: 'training:mark' }, value: 2 }] });
  mocks.db.userTraining.findUnique.mockResolvedValue({ status: 'needs_qualify' });
  mocks.db.slot.findUnique.mockResolvedValue({ ...slot(), squadRole: { name: 'R', requiredTrainingIds: [7], requiredRankIds: [] } });
  mocks.db.training.findMany.mockResolvedValue([{ id: 7, name: 'Training', requiresOrbatQualification: true }]); mocks.db.userTraining.findMany.mockResolvedValue([{ trainingId: 7, status: 'needs_qualify' }]);
  const body = { slotId: 21, userId: 5, qualificationTrainingId: 7 }; const headers = { 'idempotency-key': 'qualified' };
  expect((await POST(req('POST', body, '', headers))).status).toBe(201); mocks.db.botIdempotencyReceipt.findUnique.mockResolvedValue(mocks.db.botIdempotencyReceipt.create.mock.lastCall![0].data);
  expect((await POST(req('POST', body, '', headers))).status).toBe(201); expect(mocks.db.signup.create).toHaveBeenCalledTimes(1);
  mocks.db.userTraining.findUnique.mockResolvedValue({ status: 'qualified' }); expect((await POST(req('POST', body, '', headers))).status).toBe(409);
});

test('missing resources and invalid pagination return canonical errors', async () => {
  expect((await signups(req('GET', undefined, '?limit=0'), ctx())).status).toBe(400);
  mocks.db.user.findUnique.mockResolvedValueOnce({ id: 4, userPermissions: [] }).mockResolvedValueOnce(null);
  expect((await POST(req('POST', { slotId: 21 }))).status).toBe(404);
  mocks.db.orbat.findUnique.mockResolvedValue(null);
  for (const call of [() => signups(req('GET'), ctx()), () => available(req('GET'), ctx()), () => noteGet(req('GET'), noteCtx())]) expect((await call()).status).toBe(404);
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  mocks.db.$transaction.mockRejectedValue({ code: 'P1001' });
  expect((await POST(req('POST', { slotId: 21 }))).status).toBe(500);
  log.mockRestore();
});
test('qualification self targets require a human and missing slots are rejected', async () => {
  mocks.db.user.findUnique.mockResolvedValue({ id: 4, userPermissions: [{ permission: { key: 'training:mark' }, value: 2 }] });
  mocks.db.userTraining.findUnique.mockResolvedValue({ status: 'needs_qualify' });
  mocks.db.slot.findUnique.mockResolvedValue({ ...slot(), squadRole: { name: 'Role', requiredTrainingIds: [7], requiredRankIds: [] } });
  mocks.db.userTraining.findMany.mockResolvedValue([{ trainingId: 7, status: 'needs_qualify' }]);
  expect((await POST(req('POST', { slotId: 21, qualificationTrainingId: 7 }))).status).toBe(201);
  expect((await POST(req('POST', { slotId: 21, qualificationTrainingId: 7 }, '', { authorization: 'Bearer valid' }))).status).toBe(400);
  mocks.db.slot.findUnique.mockResolvedValue(null);
  expect((await POST(req('POST', { slotId: 21, qualificationTrainingId: 7 }))).status).toBe(404);
});
test('bot idempotency and availability changes retain bot audit attribution', async () => {
  const headers = { authorization: 'Bearer valid', 'idempotency-key': 'bot-create' };
  expect((await POST(req('POST', { slotId: 21, userId: 4 }, '', headers))).status).toBe(201);
  expect(mocks.db.botIdempotencyReceipt.create).toHaveBeenCalledOnce();
  expect((await notePatch(req('PATCH', { status: 'late_unsure', reason: ' ', leaveEarlyMinutes: 10 }, '', headers), noteCtx('4'))).status).toBe(200);
  expect(mocks.db.orbatAttendanceNote.upsert.mock.lastCall![0].update).toEqual({ status: 'late_unsure', reason: null, lateMinutes: null, leaveEarlyMinutes: 10 });
  expect(mocks.publish.mock.lastCall![0].actorUserId).toBeNull();
});
test('closed operations restrict member deletions and note edits but allow staff corrections', async () => {
  const closed = { ...operation(), startsAtUtc: new Date('2000-01-01T00:00:00Z') };
  mocks.db.slot.findUnique.mockResolvedValue({ ...slot(), orbat: closed });
  mocks.db.orbat.findUnique.mockResolvedValue(closed);
  mocks.db.user.findUnique.mockResolvedValue({ id: 4, userPermissions: [] });
  expect((await DELETE(req('DELETE'), ctx('30'))).status).toBe(409);
  expect((await notePatch(req('PATCH', { status: 'unsure' }), noteCtx())).status).toBe(409);
  mocks.db.user.findUnique.mockResolvedValue({ id: 4, userPermissions: [{ permission: { key: 'orbat:edit' }, value: 2 }] });
  expect((await DELETE(req('DELETE'), ctx('30'))).status).toBe(200);
  expect((await notePatch(req('PATCH', { status: 'unsure' }), noteCtx())).status).toBe(200);
});
test('eligibility explains every restriction while an existing occupant keeps its capacity', async () => {
  mocks.db.slot.findMany.mockResolvedValue([{ ...slot(), _count: { signups: 2 }, orbat: { ...operation(), startsAtUtc: new Date('2000-01-01T00:00:00Z') }, squadRole: { name: 'Role', requiredTrainingIds: [7], requiredRankIds: [8] } }]);
  mocks.db.orbatAttendanceNote.findUnique.mockResolvedValue({ status: 'absent' });
  const response = await eligibility(req('GET'), ctx());
  expect(response.status).toBe(200);
  expect((await response.json()).data[0].reasons.map((r: {code:string}) => r.code)).toEqual(['signup_closed', 'marked_absent', 'slot_full', 'rank_required', 'training_required']);
  mocks.db.signup.findFirst.mockResolvedValue({ id: 30, slotId: 21 });
  const own = await (await eligibility(req('GET'), ctx())).json();
  expect(own.data[0].reasons.map((r: {code:string}) => r.code)).not.toContain('slot_full');
});
test('self availability reads avoid audits and missing notes distinguish read from delete', async () => {
  expect(await (await noteGet(req('GET'), noteCtx())).json()).toEqual({ data: null, meta: {} });
  expect(mocks.db.apiAuditLog.create).not.toHaveBeenCalled();
  expect((await noteDelete(req('DELETE'), noteCtx())).status).toBe(404);
  mocks.db.signup.findMany.mockResolvedValue([{ ...signup(), user: { id: 4, username: 'Member' }, slot: { ...slot(), orbat: { ...operation(), startsAtUtc: null } } }]);
  const body = await (await userSignups(req('GET'), ctx('me'))).json();
  expect(body.data[0].orbat.startsAtUtc).toBeNull();
});
