import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ session: vi.fn(), db: { user: { findUnique: vi.fn() }, botToken: { findFirst: vi.fn(), update: vi.fn() }, orbat: { findMany: vi.fn() }, apiAuditLog: { create: vi.fn() } } }));
vi.mock('@/lib/prisma', () => ({ prisma: mocks.db }));
vi.mock('next-auth/next', () => ({ getServerSession: mocks.session }));
vi.mock('next-auth', () => ({ getServerSession: mocks.session }));
vi.mock('@/app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
import { GET } from '@/app/api/orbats/route';
const req = (query = '', authorization?: string) => new Request(`http://localhost/api/orbats${query}`, { headers: authorization === undefined ? {} : { authorization } });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue(null);
  mocks.db.user.findUnique.mockResolvedValue({ userPermissions: [] });
  mocks.db.botToken.findFirst.mockResolvedValue({ id: 9 });
  mocks.db.orbat.findMany.mockResolvedValue([{ id: 8, name: 'Latest' }]);
});
describe('public ORBAT list actual route', () => {
  it('allows anonymous, session and active bot users with identical minimal DTOs', async () => {
    const expected = { data: [{ id: 8, name: 'Latest' }], meta: { limit: 50, nextCursor: null } };
    expect(await (await GET(req())).json()).toEqual(expected);
    mocks.session.mockResolvedValue({ user: { id: 4 } });
    expect(await (await GET(req())).json()).toEqual(expected);
    expect(await (await GET(req('', 'Bearer valid'))).json()).toEqual(expected);
    expect(mocks.db.orbat.findMany).toHaveBeenCalledWith({ where: {}, orderBy: { id: 'desc' }, take: 51, select: { id: true, name: true } });
    expect(mocks.db.apiAuditLog.create).not.toHaveBeenCalled();
  });
  it.each(['Basic invalid', 'Bearer', 'Bearer bad'])('rejects explicit invalid authorization %s without fallback', async authorization => {
    mocks.session.mockResolvedValue({ user: { id: 4 } });
    mocks.db.botToken.findFirst.mockResolvedValue(null);
    expect((await GET(req('', authorization))).status).toBe(401);
    expect(mocks.session).not.toHaveBeenCalled();
    expect(mocks.db.orbat.findMany).not.toHaveBeenCalled();
  });
  it('treats stale or deleted sessions as anonymous', async () => {
    mocks.session.mockResolvedValue({ user: { id: '2147483648' } });
    expect((await GET(req())).status).toBe(200);
    mocks.session.mockResolvedValue({ user: { id: 4 } });
    mocks.db.user.findUnique.mockResolvedValue(null);
    expect((await GET(req())).status).toBe(200);
  });
  it.each(['?page=1', '?limit=1&limit=2', '?cursor=1&cursor=2', '?limit=0', '?cursor=2147483648', '?cursor=bad'])('rejects invalid filters %s', async query => {
    const response = await GET(req(query));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.correlationId).toBe(response.headers.get('X-Request-Id'));
    expect(mocks.db.orbat.findMany).not.toHaveBeenCalled();
  });
  it('uses descending cursor and actual lookahead including exact final and empty pages', async () => {
    mocks.db.orbat.findMany.mockResolvedValue([{ id: 8, name: 'Latest' }, { id: 7, name: 'Older' }]);
    expect(await (await GET(req('?cursor=9&limit=1'))).json()).toEqual({ data: [{ id: 8, name: 'Latest' }], meta: { limit: 1, nextCursor: '8' } });
    expect(mocks.db.orbat.findMany.mock.lastCall![0]).toMatchObject({ where: { id: { lt: 9 } }, take: 2 });
    mocks.db.orbat.findMany.mockResolvedValue([{ id: 8, name: 'Latest' }]);
    expect((await (await GET(req('?limit=1'))).json()).meta.nextCursor).toBeNull();
    mocks.db.orbat.findMany.mockResolvedValue([]);
    expect(await (await GET(req('?limit=200'))).json()).toEqual({ data: [], meta: { limit: 100, nextCursor: null } });
    expect(mocks.db.orbat.findMany.mock.lastCall![0].take).toBe(101);
  });
  it('returns standard safe failures with matching correlation ID', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.db.orbat.findMany.mockRejectedValue(new Error('Private database details'));
    const response = await GET(req());
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error.correlationId).toBe(response.headers.get('X-Request-Id'));
    expect(JSON.stringify(body)).not.toContain('Private database details');
    log.mockRestore();
  });
});
