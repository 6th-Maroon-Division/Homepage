import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
const session = vi.hoisted(() => ({ userId: null as number | null }));
vi.mock('next-auth', () => ({ getServerSession: async () => session.userId === null ? null : { user: { id: String(session.userId) } } }));
vi.mock('@/app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
import { prisma } from '@/lib/prisma';
import { GET } from '@/app/api/orbats/calendar/route';
import { getApiSessionPrincipal } from '@/lib/api/auth';
import { getCalendarItems, getCalendarPage, type CalendarItem } from '@/lib/api/calendar';
let memberId: number;
let otherId: number;
let staffId: number;
let approveId: number;
let adminId: number;
let markPermissionId: number;
let startsOrbatId: number;
let dateOrbatId: number;
let collisionId: number;
let ownSessionId: number;
let selfTrainerSessionId: number;
let cancelledAttendeeSessionId: number;
let proposedSessionId: number;
let cancelledSessionId: number;
let undatedSessionId: number;
let otherSessionId: number;
let ownRequestId: number;
let privateOtherRequestId: number;
const request = (query = '', token?: string) => new Request(`http://localhost/api/orbats/calendar${query}`, { headers: token ? { authorization: token } : {} });
const audits = (response: Response) => prisma.apiAuditLog.findMany({ where: { correlationId: response.headers.get('X-Request-Id')! } });
beforeAll(async () => {
  if (!process.env.API_INTEGRATION_DATABASE_URL || process.env.DATABASE_URL !== process.env.API_INTEGRATION_DATABASE_URL) throw new Error('Isolated Prisma integration database required.');
  const permission = async (key: string) => prisma.permission.upsert({ where: { key }, create: { key }, update: {} });
  markPermissionId = (await permission('training:mark')).id;
  const approvePermissionId = (await permission('training:approve_request')).id;
  const adminPermissionId = (await permission('system:super_admin')).id;
  const user = async (username: string, permissionId?: number) => (await prisma.user.create({ data: { username, email: 'private-calendar@example.test', ...(permissionId ? { userPermissions: { create: { permissionId, value: 1 } } } : {}) } })).id;
  memberId = await user('Calendar member');
  otherId = await user('Calendar other trainer');
  staffId = await user('Calendar marking staff', markPermissionId);
  approveId = await user('Calendar approval staff', approvePermissionId);
  adminId = await user('Calendar superadmin', adminPermissionId);
  const training = await prisma.training.create({ data: { name: 'Calendar integration course' } });
  startsOrbatId = (await prisma.orbat.create({ data: { name: 'Calendar starts priority', createdById: staffId, startsAtUtc: new Date('2026-10-01T00:30:00+02:00'), eventDate: new Date('2026-09-01T00:00:00Z') } })).id;
  dateOrbatId = (await prisma.orbat.create({ data: { name: 'Calendar event fallback', createdById: staffId, eventDate: new Date('2026-10-03T12:00:00Z') } })).id;
  const scheduled = async (status: 'scheduled' | 'proposed' | 'cancelled' = 'scheduled', startsAt: Date | null = new Date('2026-10-04T18:00:00Z'), trainerId = otherId) => prisma.trainingSession.create({ data: { trainingId: training.id, trainerId, startsAt, status, specialInstructions: 'Private calendar instructions' } });
  ownSessionId = (await scheduled()).id;
  ownRequestId = (await prisma.trainingRequest.create({ data: { userId: memberId, trainingId: training.id, requestMessage: 'Private member request message' } })).id;
  await prisma.trainingSessionAttendee.create({ data: { sessionId: ownSessionId, userId: memberId, trainingRequestId: ownRequestId } });
  selfTrainerSessionId = (await scheduled('scheduled', new Date('2026-10-05T18:00:00Z'), memberId)).id;
  privateOtherRequestId = (await prisma.trainingRequest.create({ data: { userId: otherId, trainingId: training.id, requestMessage: 'Private other request message' } })).id;
  await prisma.trainingSessionAttendee.create({ data: { sessionId: selfTrainerSessionId, userId: otherId, trainingRequestId: privateOtherRequestId } });
  await prisma.trainingSessionAttendee.create({ data: { sessionId: selfTrainerSessionId, userId: memberId } });
  cancelledAttendeeSessionId = (await scheduled()).id;
  await prisma.trainingSessionAttendee.create({ data: { sessionId: cancelledAttendeeSessionId, userId: memberId, status: 'cancelled' } });
  proposedSessionId = (await scheduled('proposed')).id;
  cancelledSessionId = (await scheduled('cancelled')).id;
  undatedSessionId = (await scheduled('scheduled', null)).id;
  for (const sessionId of [proposedSessionId, cancelledSessionId, undatedSessionId]) await prisma.trainingSessionAttendee.create({ data: { sessionId, userId: memberId } });
  otherSessionId = (await scheduled()).id;
  await prisma.trainingSessionAttendee.create({ data: { sessionId: otherSessionId, userId: otherId } });
  const [maxOrbat, maxSession] = await Promise.all([prisma.orbat.aggregate({ _max: { id: true } }), prisma.trainingSession.aggregate({ _max: { id: true } })]);
  collisionId = Math.max(maxOrbat._max.id ?? 0, maxSession._max.id ?? 0) + 1000;
  await prisma.orbat.create({ data: { id: collisionId, name: 'Calendar created fallback collision', createdById: staffId, createdAt: new Date('2026-10-06T12:00:00Z'), isSideOp: true } });
  await prisma.trainingSession.create({ data: { id: collisionId, trainingId: training.id, trainerId: otherId, startsAt: new Date('2026-10-07T00:30:00+02:00'), status: 'scheduled' } });
  await prisma.trainingSessionAttendee.create({ data: { sessionId: collisionId, userId: memberId } });
});
beforeEach(() => { session.userId = null; });
afterAll(async () => {
  try {
    if (collisionId) {
      await prisma.trainingSession.deleteMany({ where: { id: collisionId } });
      await prisma.orbat.deleteMany({ where: { id: collisionId } });
    }
  } finally { await prisma.$disconnect(); }
});

test('shared SSR calendar helpers match every API page for anonymous members and deleted sessions', async () => {
  const deleted = await prisma.user.create({ data: { username: 'Calendar deleted session' } });
  await prisma.user.delete({ where: { id: deleted.id } });
  for (const userId of [null, memberId, deleted.id]) {
    session.userId = userId;
    const principal = await getApiSessionPrincipal();
    if (userId === memberId) expect(principal).toMatchObject({ kind: 'user', userId: memberId });
    else expect(principal).toBeNull();
    const items: CalendarItem[] = [];
    let cursor: string | null = null;
    do {
      const response = await GET(request(`?limit=2${cursor ? `&cursor=${cursor}` : ''}`));
      expect(response.status).toBe(200);
      const page = await response.json();
      const sharedPage = await getCalendarPage(principal, { limit: 2, cursor });
      expect({ data: page.data, meta: page.meta }).toEqual({ data: sharedPage.data, meta: sharedPage.meta });
      items.push(...page.data);
      cursor = page.meta.nextCursor;
    } while (cursor);
    expect(await getCalendarItems(principal)).toEqual(items);
    expect(items.filter(item => item.kind === 'training_session').map(item => item.id)).toEqual(userId === memberId ? [collisionId, selfTrainerSessionId, ownSessionId] : []);
  }
});

test('anonymous calendar exposes only operations with UTC start event and creation fallbacks and no user-read audits', async () => {
  const response = await GET(request('?limit=3'));
  expect(response.status).toBe(200);
  const data = (await response.json()).data;
  expect(data.map((row: { id: number }) => row.id)).toEqual([collisionId, dateOrbatId, startsOrbatId]);
  expect(data[0]).toMatchObject({ kind: 'orbat', isSideOp: true, eventDate: '2026-10-06T12:00:00.000Z', dateKey: '2026-10-06', href: `/orbats/${collisionId}` });
  expect(data[1].eventDate).toBe('2026-10-03T12:00:00.000Z');
  expect(data[2]).toMatchObject({ eventDate: '2026-09-30T22:30:00.000Z', dateKey: '2026-09-30' });
  expect(await audits(response)).toEqual([]);
  const noTraining = await GET(request(`?cursor=training_session:${collisionId + 1}`));
  expect((await noTraining.json()).data).toEqual([]);
});

test('member sessions are filtered before pagination and request links expose only the member active attendee request', async () => {
  session.userId = memberId;
  const response = await GET(request(`?cursor=training_session:${collisionId + 1}&limit=100`));
  expect(response.status).toBe(200);
  const { data, meta } = await response.json();
  expect(data.map((row: { id: number }) => row.id)).toEqual([collisionId, selfTrainerSessionId, ownSessionId]);
  expect(meta.nextCursor).toBeNull();
  expect(data[0]).toMatchObject({ kind: 'training_session', name: 'Calendar integration course Training', eventDate: '2026-10-06T22:30:00.000Z', dateKey: '2026-10-06', trainerName: 'Calendar other trainer', href: '/profile?tab=trainings' });
  expect(data.find((row: { id: number }) => row.id === ownSessionId).href).toBe(`/trainings/requests/${ownRequestId}`);
  expect(data.find((row: { id: number }) => row.id === selfTrainerSessionId).href).toBe('/profile?tab=trainings');
  for (const row of data) expect(Object.keys(row).sort()).toEqual(['id', 'kind', 'name', 'description', 'eventDate', 'dateKey', 'status', 'trainerName', 'href'].sort());
  expect(JSON.stringify(data)).not.toContain(`/trainings/requests/${privateOtherRequestId}`);
  expect(JSON.stringify(data)).not.toContain('Private calendar instructions');
  expect(JSON.stringify(data)).not.toContain('private-calendar@example.test');
  expect((await audits(response))[0]).toMatchObject({ actorUserId: memberId, targetUserIds: [otherId], before: null, after: null });
});

test('composite cursors preserve colliding IDs and paginate across the operation-to-session boundary with real lookahead', async () => {
  session.userId = memberId;
  const head = await (await GET(request('?limit=1'))).json();
  expect(head.data[0]).toMatchObject({ id: collisionId, kind: 'orbat' });
  expect(head.meta.nextCursor).toBe(`orbat:${collisionId}`);
  const oldest = await prisma.orbat.findFirstOrThrow({ orderBy: { id: 'asc' } });
  const boundary = await (await GET(request(`?cursor=orbat:${oldest.id + 1}&limit=2`))).json();
  expect(boundary.data.map((row: { id: number; kind: string }) => [row.kind, row.id])).toEqual([['orbat', oldest.id], ['training_session', collisionId]]);
  expect(boundary.meta.nextCursor).toBe(`training_session:${collisionId}`);
  const rest = await (await GET(request(`?cursor=${boundary.meta.nextCursor}&limit=2`))).json();
  expect(rest.data.map((row: { id: number }) => row.id)).toEqual([selfTrainerSessionId, ownSessionId]);
  expect(rest.meta.nextCursor).toBeNull();
  const empty = await GET(request(`?cursor=training_session:${ownSessionId}`));
  expect((await empty.json()).data).toEqual([]);
  expect(await audits(empty)).toEqual([]);
});

test('staff grants and bot superadmin expose all dated sessions including proposed and cancelled while revoked grants return member visibility', async () => {
  for (const userId of [staffId, approveId, adminId]) {
    session.userId = userId;
    const page = await (await GET(request(`?cursor=training_session:${collisionId + 1}&limit=100`))).json();
    const ids = page.data.map((row: { id: number }) => row.id);
    expect(ids).toEqual(expect.arrayContaining([collisionId, ownSessionId, selfTrainerSessionId, cancelledAttendeeSessionId, proposedSessionId, cancelledSessionId, otherSessionId]));
    expect(ids).not.toContain(undatedSessionId);
    for (const row of page.data) expect(row.href).toBe(`/admin/trainings?tab=sessions&session=${row.id}`);
  }
  await prisma.userPermission.update({ where: { userId_permissionId: { userId: staffId, permissionId: markPermissionId } }, data: { value: 0 } });
  session.userId = staffId;
  try { expect((await (await GET(request(`?cursor=training_session:${collisionId + 1}`))).json()).data).toEqual([]); }
  finally { await prisma.userPermission.update({ where: { userId_permissionId: { userId: staffId, permissionId: markPermissionId } }, data: { value: 1 } }); }
  const bot = await prisma.botToken.create({ data: { name: 'Calendar integration bot', token: 'calendar-integration-token' } });
  session.userId = null;
  const botRead = await GET(request(`?cursor=training_session:${collisionId + 1}&limit=1`, `Bearer ${bot.token}`));
  expect(botRead.status).toBe(200);
  expect((await botRead.json()).data[0].href).toBe(`/admin/trainings?tab=sessions&session=${collisionId}`);
  expect((await audits(botRead))[0]).toMatchObject({ actorType: 'bot', actorTokenId: bot.id, targetUserIds: [otherId], before: null, after: null });
  await prisma.botToken.update({ where: { id: bot.id }, data: { isActive: false } });
  session.userId = staffId;
  for (const token of [`Bearer ${bot.token}`, 'Bearer invalid-calendar-token', 'Basic invalid', 'Bearer invalid token']) expect((await GET(request('', token))).status).toBe(401);
});

test('calendar audits include only displayed other trainers and fail closed when required audit persistence fails', async () => {
  session.userId = memberId;
  const self = await GET(request(`?cursor=training_session:${selfTrainerSessionId + 1}&limit=1`));
  expect((await self.json()).data[0].trainerName).toBe('Calendar member');
  expect(await audits(self)).toEqual([]);
  const other = await GET(request(`?cursor=training_session:${collisionId + 1}&limit=1`));
  expect((await audits(other))[0]).toMatchObject({ action: 'user_data.read', targetUserIds: [otherId], before: null, after: null, method: 'GET', path: '/api/orbats/calendar' });
  const failure = vi.spyOn(prisma.apiAuditLog, 'create').mockRejectedValue(new Error('Audit storage unavailable'));
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  let response: Response;
  try { response = await GET(request(`?cursor=training_session:${collisionId + 1}&limit=1`)); }
  finally { failure.mockRestore(); log.mockRestore(); }
  expect(response.status).toBe(500);
  const body = await response.json();
  expect(body.data).toBeUndefined();
  expect(body.error.code).toBe('internal_error');
  expect(JSON.stringify(body)).not.toContain('Calendar other trainer');
});

test('calendar rejects unknown duplicate and malformed composite cursor query arguments', async () => {
  for (const query of ['?page=1', '?limit=1&limit=2', '?cursor=orbat:1&cursor=orbat:2', '?cursor=1', '?cursor=user:1', '?cursor=orbat:0', '?cursor=training_session:2147483648', '?limit=0']) expect((await GET(request(query))).status).toBe(400);
});
