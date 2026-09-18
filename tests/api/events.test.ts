import { beforeEach, afterEach, expect, test, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ session: vi.fn(), db: { user: { findUnique: vi.fn() }, botToken: { findFirst: vi.fn(), update: vi.fn() }, botEvent: { findMany: vi.fn() }, apiAuditLog: { create: vi.fn() } } }));
vi.mock('next-auth', () => ({ getServerSession: mocks.session }));
vi.mock('@/app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
vi.mock('@/lib/prisma', () => ({ prisma: mocks.db }));
import { GET } from '@/app/api/events/route';
const req = (query = '?aggregate=rank', headers: Record<string, string> = {}, signal?: AbortSignal) => new Request(`http://localhost/api/events${query}`, { headers, signal });
const row = (id = 1, userId = 5) => ({ id: BigInt(id), aggregate: 'rank', type: 'user.rank_changed', occurredAt: new Date('2026-09-18T10:00:00Z'), payload: { userId, rankHistoryId: 8, oldRankId: null, newRankId: 9, discordUserId: '123456789012345678', source: 'automatic', reason: 'Private reason', token: 'secret' } });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ user: { id: 4 } });
  mocks.db.user.findUnique.mockResolvedValue({ userPermissions: [{ permission: { key: 'system:super_admin' }, value: 1 }] });
  mocks.db.botToken.findFirst.mockResolvedValue({ id: 9 });
  mocks.db.botEvent.findMany.mockResolvedValue([]);
});
afterEach(() => { vi.useRealTimers(); });
test('auth accepts live superadmin sessions and active bots but rejects revoked and unprivileged credentials', async () => {
  expect((await GET(req())).status).toBe(200);
  expect((await GET(req(undefined, { authorization: 'Bearer valid' }))).status).toBe(200);
  mocks.db.botToken.findFirst.mockResolvedValue(null);
  expect((await GET(req(undefined, { authorization: 'Bearer revoked' }))).status).toBe(401);
  expect((await GET(req(undefined, { authorization: 'broken' }))).status).toBe(401);
  mocks.db.user.findUnique.mockResolvedValue({ userPermissions: [] });
  expect((await GET(req())).status).toBe(403);
  mocks.session.mockResolvedValue(null);
  expect((await GET(req())).status).toBe(401);
});
test.each(['', '?aggregate=bad', '?aggregate=rank&aggregate=orbat', '?aggregate=rank&page=1', '?aggregate=rank&cursor=-1', '?aggregate=rank&cursor=0x10', '?aggregate=rank&cursor=01', '?aggregate=rank&cursor=9223372036854775808', '?aggregate=rank&limit=0', '?aggregate=rank&limit=1.5', '?aggregate=rank&limit=1&limit=2'])('rejects malformed query %s', async query => {
  expect((await GET(req(query))).status).toBe(400);
  expect(mocks.db.botEvent.findMany).not.toHaveBeenCalled();
});
test('ascending BigInt pagination has lookahead, final null and resumable checkpoint; caps limit', async () => {
  mocks.db.botEvent.findMany.mockResolvedValue([row(8), row(9), row(10)]);
  const response = await GET(req('?aggregate=rank&limit=2&cursor=7'));
  const body = await response.json();
  expect(body.meta).toEqual({ limit: 2, nextCursor: '9', resumeCursor: '9' });
  expect(body.data.map((item: { id: string }) => item.id)).toEqual(['8', '9']);
  expect(body.data[0].occurredAt).toBe('2026-09-18T10:00:00.000Z');
  expect(JSON.stringify(body)).not.toContain('Private reason');
  expect(JSON.stringify(body)).not.toContain('secret');
  expect(mocks.db.botEvent.findMany).toHaveBeenCalledWith({ where: { aggregate: 'rank', id: { gt: BigInt(7) } }, orderBy: { id: 'asc' }, take: 3 });
  mocks.db.botEvent.findMany.mockResolvedValue([]);
  expect((await (await GET(req('?aggregate=rank&cursor=9223372036854775807&limit=999'))).json()).meta).toEqual({ limit: 100, nextCursor: null, resumeCursor: '9223372036854775807' });
});
test('audits only returned other users, excluding self and lookahead; operation-only reads do not audit', async () => {
  mocks.db.botEvent.findMany.mockResolvedValue([row(1, 4), row(2, 5), row(3, 6)]);
  await GET(req('?aggregate=rank&limit=2'));
  expect(mocks.db.apiAuditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ targetUserIds: [5], action: 'user_data.read', resource: 'event' }) });
  mocks.db.apiAuditLog.create.mockClear();
  mocks.db.botEvent.findMany.mockResolvedValue([row(1, 4)]);
  await GET(req());
  expect(mocks.db.apiAuditLog.create).not.toHaveBeenCalled();
  mocks.db.botEvent.findMany.mockResolvedValue([{ ...row(), aggregate: 'orbat', payload: { orbatId: 1, name: 'Public', version: '2026-09-18T12:00:00+02:00' } }]);
  const body = await (await GET(req('?aggregate=orbat'))).json();
  expect(body.data[0].payload.version).toBe('2026-09-18T10:00:00.000Z');
  expect(mocks.db.apiAuditLog.create).not.toHaveBeenCalled();
});
test('audit failure prevents JSON and SSE handshake from delivering personal records', async () => {
  mocks.db.botEvent.findMany.mockResolvedValue([row()]);
  mocks.db.apiAuditLog.create.mockRejectedValue(new Error('private'));
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  for (const headers of [{}, { accept: 'text/event-stream' }] as Record<string, string>[]) {
    const response = await GET(req(undefined, headers));
    expect(response.status).toBe(500);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(JSON.stringify(await response.json())).not.toContain('123456789012345678');
  }
  log.mockRestore();
});
test('SSE uses canonical data envelopes, honors Last-Event-ID and closes when bot is revoked', async () => {
  vi.useFakeTimers();
  mocks.db.botEvent.findMany.mockResolvedValue([row(8)]);
  const response = await GET(req('?aggregate=rank', { accept: 'text/event-stream', authorization: 'Bearer valid', 'last-event-id': '7' }));
  expect(response.headers.get('content-type')).toBe('text/event-stream');
  const reader = response.body!.getReader();
  const first = new TextDecoder().decode((await reader.read()).value);
  expect(first).toContain('id: 8\nevent: user.rank_changed\ndata: {"data":');
  expect(first).not.toContain('secret');
  mocks.db.botToken.findFirst.mockResolvedValue(null);
  await vi.advanceTimersByTimeAsync(5000);
  expect((await reader.read()).done).toBe(true);
  expect(mocks.db.botEvent.findMany).toHaveBeenCalledTimes(1);
});
test('SSE rechecks session grants and avoids fetching after revocation', async () => {
  vi.useFakeTimers();
  const response = await GET(req(undefined, { accept: 'text/event-stream' }));
  const reader = response.body!.getReader(); await reader.read();
  mocks.db.user.findUnique.mockResolvedValue({ userPermissions: [] });
  await vi.advanceTimersByTimeAsync(5000);
  expect((await reader.read()).done).toBe(true);
  expect(mocks.db.botEvent.findMany).toHaveBeenCalledTimes(1);
});
test('SSE polls serially, audit failures close without delivering the failed batch, cancellation stops polling', async () => {
  vi.useFakeTimers();
  const abort = new AbortController();
  const response = await GET(req(undefined, { accept: 'text/event-stream' }, abort.signal));
  const reader = response.body!.getReader(); await reader.read();
  mocks.db.botEvent.findMany.mockResolvedValue([row()]);
  mocks.db.apiAuditLog.create.mockRejectedValue(new Error('private'));
  await vi.advanceTimersByTimeAsync(5000);
  expect((await reader.read()).done).toBe(true);
  await vi.advanceTimersByTimeAsync(10000);
  expect(mocks.db.botEvent.findMany).toHaveBeenCalledTimes(2);
  abort.abort();
});
test('conflicting resume sources fail before reads', async () => {
  expect((await GET(req('?aggregate=rank&cursor=8', { 'last-event-id': '7' }))).status).toBe(400);
});
