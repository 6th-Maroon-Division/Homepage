import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => {
  const model = () => ({ findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn(), create: vi.fn() });
  return { session: vi.fn(), db: { user: model(), botToken: model(), orbat: model(), trainingSession: model(), apiAuditLog: model() } };
});
vi.mock('@/lib/prisma', () => ({ prisma: mocks.db }));
vi.mock('next-auth', () => ({ getServerSession: mocks.session }));
vi.mock('@/app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
import { GET } from '@/app/api/orbats/calendar/route';
import { getCalendarItems, getCalendarPage, parseCalendarPagination } from '@/lib/api/calendar';
import { getApiSessionPrincipal, requireApiAccess } from '@/lib/api/auth';
import type { ApiPrincipal } from '@/lib/api/principal';
const member: ApiPrincipal = { kind: 'user', userId: 4, permissions: {} };
const staff: ApiPrincipal = { kind: 'user', userId: 4, permissions: { 'training:mark': 1 } };
const bot: ApiPrincipal = { kind: 'bot', tokenId: 9, permissions: { 'system:super_admin': 255 } };
const date = new Date('2026-09-17T23:30:00Z');
const op = { id: 10, name: 'Operation', description: null, startsAtUtc: date, eventDate: date, createdAt: date, isSideOp: false };
const session = { id: 10, startsAt: date, status: 'scheduled', training: { name: 'Medic' }, trainer: { id: 5, username: 'Trainer' }, attendees: [{ trainingRequestId: 7 }] };
const req = (query = '', token?: string) => new Request(`http://localhost/api/orbats/calendar${query}`, { headers: token ? { authorization: token } : {} });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue(null);
  mocks.db.user.findUnique.mockResolvedValue({ userPermissions: [] });
  mocks.db.botToken.findFirst.mockResolvedValue({ id: 9 });
  mocks.db.orbat.findMany.mockImplementation(async ({ where, take }) => [op].filter(row => !where.id || row.id < where.id.lt).slice(0, take));
  mocks.db.trainingSession.findMany.mockImplementation(async ({ where, take }) => [session].filter(row => !where.id || row.id < where.id.lt).slice(0, take));
});
describe('calendar optional authentication and live SSR identity', () => {
  it('keeps anonymous operations public without querying training sessions', async () => {
    const response = await GET(req());
    expect(response.status).toBe(200);
    expect((await response.json()).data.map((item: { kind: string }) => item.kind)).toEqual(['orbat']);
    expect(mocks.db.trainingSession.findMany).not.toHaveBeenCalled();
    expect(mocks.db.apiAuditLog.create).not.toHaveBeenCalled();
  });
  it('accepts authenticated user and bot and refuses invalid explicit tokens without fallback', async () => {
    mocks.session.mockResolvedValue({ user: { id: 4 } });
    expect((await GET(req())).status).toBe(200);
    expect((await GET(req('', 'Bearer valid'))).status).toBe(200);
    mocks.session.mockClear();
    mocks.db.botToken.findFirst.mockResolvedValue(null);
    expect((await GET(req('', 'Bearer revoked'))).status).toBe(401);
    expect((await GET(req('', 'Basic xyz'))).status).toBe(401);
    expect(mocks.session).not.toHaveBeenCalled();
  });
  it('resolves SSR identity from session plus current database grants', async () => {
    expect(await getApiSessionPrincipal()).toBeNull();
    mocks.session.mockResolvedValue({ user: { id: 'bad' } });
    expect(await getApiSessionPrincipal()).toBeNull();
    mocks.session.mockResolvedValue({ user: { id: '4', permissions: { 'system:super_admin': 255 } } });
    expect(await getApiSessionPrincipal()).toEqual(member);
    mocks.db.user.findUnique.mockResolvedValue({ userPermissions: [{ permission: { key: 'training:mark' }, value: 1 }] });
    expect(await getApiSessionPrincipal()).toEqual(staff);
    mocks.db.user.findUnique.mockResolvedValue(null);
    expect(await getApiSessionPrincipal()).toBeNull();
  });
});
describe('calendar paging contract', () => {
  it.each(['?other=1', '?limit=1&limit=2', '?cursor=orbat:2&cursor=orbat:3', '?limit=0', '?cursor=2', '?cursor=orbat:0', '?cursor=orbat:01', '?cursor=training_session:2147483648', '?cursor=other:2'])('rejects invalid parameters %s', async query => expect((await GET(req(query))).status).toBe(400));
  it('defaults and caps page sizes', () => {
    expect(parseCalendarPagination(new URLSearchParams())).toEqual({ data: { limit: 50, cursor: null } });
    expect(parseCalendarPagination(new URLSearchParams('limit=200&cursor=training_session:1'))).toEqual({ data: { limit: 100, cursor: 'training_session:1' } });
  });
  it('returns a cursor across kinds when operations fill a page exactly', async () => {
    const first = await getCalendarPage(member, { limit: 1, cursor: null });
    expect(first.data.map(item => item.kind)).toEqual(['orbat']);
    expect(first.meta.nextCursor).toBe('orbat:10');
    expect(first.targetUserIds).toEqual([]);
    expect(mocks.db.trainingSession.findMany.mock.lastCall![0].take).toBe(1);
    const second = await getCalendarPage(member, { limit: 1, cursor: first.meta.nextCursor });
    expect(second.data.map(item => item.kind)).toEqual(['training_session']);
    expect(second.meta.nextCursor).toBeNull();
  });
  it('handles operation lookahead without querying sessions and training-only continuations', async () => {
    mocks.db.orbat.findMany.mockResolvedValue([op, { ...op, id: 9 }]);
    expect((await getCalendarPage(member, { limit: 1, cursor: null })).meta.nextCursor).toBe('orbat:10');
    expect(mocks.db.trainingSession.findMany).not.toHaveBeenCalled();
    mocks.db.orbat.findMany.mockClear();
    mocks.db.trainingSession.findMany.mockResolvedValue([session, { ...session, id: 9 }]);
    const page = await getCalendarPage(staff, { limit: 1, cursor: 'training_session:11' });
    expect(page.meta.nextCursor).toBe('training_session:10');
    expect(mocks.db.orbat.findMany).not.toHaveBeenCalled();
    expect(mocks.db.trainingSession.findMany.mock.lastCall![0].where.id).toEqual({ lt: 11 });
  });
  it('does not produce a cursor for an exact final page or anonymous training continuation', async () => {
    expect((await getCalendarPage(null, { limit: 1, cursor: null })).meta.nextCursor).toBeNull();
    expect((await getCalendarPage(null, { limit: 1, cursor: 'training_session:10' })).data).toEqual([]);
    mocks.db.trainingSession.findMany.mockResolvedValue([]);
    expect((await getCalendarPage(member, { limit: 1, cursor: null })).meta.nextCursor).toBeNull();
  });
  it('returns all pages for SSR without audit writes', async () => {
    const ops = Array.from({ length: 101 }, (_, index) => ({ ...op, id: 101 - index }));
    mocks.db.orbat.findMany.mockImplementation(async ({ where, take }) => ops.filter(row => !where.id || row.id < where.id.lt).slice(0, take));
    expect((await getCalendarItems(null)).length).toBe(101);
    expect(mocks.db.orbat.findMany).toHaveBeenCalledTimes(2);
    expect(mocks.db.apiAuditLog.create).not.toHaveBeenCalled();
  });
});
describe('calendar visibility and DTO privacy', () => {
  it('filters active own attendance before pagination and only selects own request IDs', async () => {
    const page = await getCalendarPage(member, { limit: 50, cursor: null });
    const args = mocks.db.trainingSession.findMany.mock.lastCall![0];
    expect(args.where).toEqual({ startsAt: { not: null }, status: { notIn: ['proposed', 'cancelled'] }, attendees: { some: { userId: 4, status: { not: 'cancelled' } } } });
    expect(args.select.attendees).toEqual({ where: { userId: 4, status: { not: 'cancelled' }, trainingRequestId: { not: null } }, orderBy: { id: 'asc' }, take: 1, select: { trainingRequestId: true } });
    expect(page.data[1]).toMatchObject({ name: 'Medic Training', href: '/trainings/requests/7', trainerName: 'Trainer', dateKey: '2026-09-17', eventDate: '2026-09-17T23:30:00.000Z' });
    expect(page.data[1]).not.toHaveProperty('attendees');
  });
  it.each([staff, bot])('shows all dated sessions to eligible staff/bots with admin links', async principal => {
    const page = await getCalendarPage(principal, { limit: 50, cursor: null });
    expect(mocks.db.trainingSession.findMany.mock.lastCall![0].where).toEqual({ startsAt: { not: null } });
    expect(page.data[1].href).toBe('/admin/trainings?tab=sessions&session=10');
  });
  it('uses profile fallback and omits undisplayed trainers from auditing', async () => {
    mocks.db.trainingSession.findMany.mockResolvedValue([{ ...session, attendees: [], trainer: null }]);
    const page = await getCalendarPage(member, { limit: 50, cursor: null });
    expect(page.data[1]).toMatchObject({ href: '/profile?tab=trainings', trainerName: null, description: 'scheduled · Arma3 Training Server' });
    expect(page.targetUserIds).toEqual([]);
  });
  it('preserves UTC date fallback from event date and creation time', async () => {
    mocks.db.orbat.findMany.mockResolvedValue([{ ...op, startsAtUtc: null, eventDate: date }, { ...op, id: 9, startsAtUtc: null, eventDate: null, createdAt: date }]);
    expect((await getCalendarPage(null, { limit: 50, cursor: null })).data.map(item => item.eventDate)).toEqual(['2026-09-17T23:30:00.000Z', '2026-09-17T23:30:00.000Z']);
  });
});
describe('calendar trainer read audits', () => {
  it('audits only displayed other trainers and excludes lookahead', async () => {
    mocks.session.mockResolvedValue({ user: { id: 4 } });
    mocks.db.trainingSession.findMany.mockResolvedValue([session, { ...session, id: 9, trainer: { id: 99, username: 'Not shown' } }]);
    await GET(req('?limit=2'));
    const audit = mocks.db.apiAuditLog.create.mock.lastCall![0].data;
    expect(audit).toMatchObject({ action: 'user_data.read', resource: 'calendar', targetUserIds: [5] });
    expect(audit).not.toHaveProperty('before'); expect(audit).not.toHaveProperty('after');
    expect(JSON.stringify(audit)).not.toContain('Trainer');
  });
  it('excludes self trainers while bots audit all displayed trainers', async () => {
    mocks.session.mockResolvedValue({ user: { id: 4 } });
    mocks.db.trainingSession.findMany.mockResolvedValue([{ ...session, trainer: { id: 4, username: 'Self' } }]);
    await GET(req());
    expect(mocks.db.apiAuditLog.create).not.toHaveBeenCalled();
    await GET(req('', 'Bearer valid'));
    expect(mocks.db.apiAuditLog.create.mock.lastCall![0].data).toMatchObject({ actorTokenId: 9, targetUserIds: [4] });
  });
  it('withholds data on required audit failure', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.session.mockResolvedValue({ user: { id: 4 } });
    mocks.db.apiAuditLog.create.mockRejectedValue(new Error('Audit unavailable'));
    const response = await GET(req());
    expect(response.status).toBe(500);
    expect(await response.json()).not.toHaveProperty('data');
    log.mockRestore();
  });
});

it('treats an out-of-range session ID as anonymous without querying Prisma', async () => {
  mocks.session.mockResolvedValue({ user: { id: '2147483648' } });
  expect(await getApiSessionPrincipal()).toBeNull();
  expect((await GET(req())).status).toBe(200);
  const access = await requireApiAccess(req());
  expect(access.error?.status).toBe(401);
  expect(mocks.db.user.findUnique).not.toHaveBeenCalled();
  expect(mocks.db.trainingSession.findMany).not.toHaveBeenCalled();
});

it('preserves timed versus date-only calendar entries without changing eventDate fallbacks', async () => {
  const calendarDate = new Date('2026-09-17T00:00:00Z');
  mocks.db.orbat.findMany.mockResolvedValue([
    { ...op, eventDate: calendarDate },
    { ...op, id: 9, startsAtUtc: null, eventDate: calendarDate },
    { ...op, id: 8, startsAtUtc: null, eventDate: null },
  ]);
  mocks.session.mockResolvedValue({ user: { id: 4 } });
  const response = await GET(req());
  expect(response.status).toBe(200);
  const { data } = await response.json();
  expect(data.map((item: { eventDate: string; startsAtUtc: string | null }) => ({ eventDate: item.eventDate, startsAtUtc: item.startsAtUtc }))).toEqual([
    { eventDate: date.toISOString(), startsAtUtc: date.toISOString() },
    { eventDate: calendarDate.toISOString(), startsAtUtc: null },
    { eventDate: date.toISOString(), startsAtUtc: null },
    { eventDate: date.toISOString(), startsAtUtc: date.toISOString() },
  ]);
  for (const item of data.slice(0, 3)) {
    expect(Object.keys(item).sort()).toEqual(['id', 'kind', 'name', 'description', 'eventDate', 'startsAtUtc', 'dateKey', 'href', 'isSideOp'].sort());
  }
  expect(Object.keys(data[3]).sort()).toEqual(['id', 'kind', 'name', 'description', 'eventDate', 'startsAtUtc', 'dateKey', 'href', 'status', 'trainerName'].sort());
});
