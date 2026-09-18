import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
const session = vi.hoisted(() => ({ userId: null as number | null }));
vi.mock('next-auth', () => ({ getServerSession: async () => session.userId === null ? null : { user: { id: session.userId } } }));
vi.mock('@/app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
import { prisma } from '@/lib/prisma';
import { GET } from '@/app/api/events/route';
let userId: number, otherId: number, permissionId: number, tokenId: number;
const token = 'event-feed-integration-token';
const req = (query = '?aggregate=rank', headers: Record<string, string> = {}) => new Request(`http://localhost/api/events${query}`, { headers });
const audits = (response: Response) => prisma.apiAuditLog.findMany({ where: { correlationId: response.headers.get('X-Request-Id')! } });
const event = (target: number, aggregate = 'rank') => prisma.botEvent.create({ data: { aggregate, type: aggregate === 'rank' ? 'user.rank_changed' : 'orbat.signup_changed', payload: { userId: target, newRankId: 1, discordUserId: '123456789012345678', reason: 'Do not expose', token: 'Do not expose' }, occurredAt: new Date('2026-09-18T12:00:00+02:00') } });
beforeAll(async () => {
  permissionId = (await prisma.permission.upsert({ where: { key: 'system:super_admin' }, create: { key: 'system:super_admin' }, update: {} })).id;
  userId = (await prisma.user.create({ data: { username: 'Event feed manager', userPermissions: { create: { permissionId, value: 1 } } } })).id;
  otherId = (await prisma.user.create({ data: { username: 'Event feed target' } })).id;
  tokenId = (await prisma.botToken.create({ data: { name: 'Event feed bot', token } })).id;
});
beforeEach(() => { session.userId = userId; });
afterAll(async () => { await prisma.$disconnect(); });
test('real BigInt feed paging isolates aggregates, returns minimal UTC data and audits only displayed others', async () => {
  const start = await event(userId);
  const other = await event(otherId);
  await event(otherId, 'orbat');
  const lookahead = await event(otherId);
  const response = await GET(req(`?aggregate=rank&cursor=${start.id - BigInt(1)}&limit=2`));
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.data.map((row: { id: string }) => row.id)).toEqual([String(start.id), String(other.id)]);
  expect(body.meta).toEqual({ limit: 2, nextCursor: String(other.id), resumeCursor: String(other.id) });
  expect(body.data[0].occurredAt).toBe('2026-09-18T10:00:00.000Z');
  expect(JSON.stringify(body)).not.toContain('Do not expose');
  expect(await audits(response)).toEqual([expect.objectContaining({ targetUserIds: [otherId], before: null, after: null, actorUserId: userId })]);
  const final = await GET(req(`?aggregate=rank&cursor=${other.id}&limit=1`));
  expect((await final.json()).meta).toEqual({ limit: 1, nextCursor: null, resumeCursor: String(lookahead.id) });
  const empty = await GET(req(`?aggregate=rank&cursor=${lookahead.id}`));
  expect((await empty.json()).data).toEqual([]);
  expect(await audits(empty)).toEqual([]);
});
test('self-only and public operation payloads do not audit; bot reads audit even the session account', async () => {
  const self = await event(userId);
  const own = await GET(req(`?aggregate=rank&cursor=${self.id - BigInt(1)}`));
  expect(await audits(own)).toEqual([]);
  const bot = await GET(req(`?aggregate=rank&cursor=${self.id - BigInt(1)}`, { authorization: `Bearer ${token}` }));
  expect(await audits(bot)).toEqual([expect.objectContaining({ actorType: 'bot', actorTokenId: tokenId, targetUserIds: [userId] })]);
  const operation = await prisma.botEvent.create({ data: { aggregate: 'orbat', type: 'orbat.created', payload: { orbatId: 1, name: 'Operation', version: '2026-09-18T12:00:00+02:00' } } });
  const publicData = await GET(req(`?aggregate=orbat&cursor=${operation.id - BigInt(1)}`));
  expect((await publicData.json()).data[0].payload).toEqual({ orbatId: 1, name: 'Operation', version: '2026-09-18T10:00:00.000Z' });
  expect(await audits(publicData)).toEqual([]);
});
test('live permission revocation and invalid explicit credentials fail without session fallback', async () => {
  await prisma.userPermission.update({ where: { userId_permissionId: { userId, permissionId } }, data: { value: 0 } });
  expect((await GET(req())).status).toBe(403);
  await prisma.userPermission.update({ where: { userId_permissionId: { userId, permissionId } }, data: { value: 1 } });
  expect((await GET(req('?aggregate=rank', { authorization: 'bad' }))).status).toBe(401);
  await prisma.botToken.update({ where: { id: tokenId }, data: { isActive: false } });
  expect((await GET(req('?aggregate=rank', { authorization: `Bearer ${token}` }))).status).toBe(401);
  await prisma.botToken.update({ where: { id: tokenId }, data: { isActive: true } });
});
test('SSE handshake uses actual stored events and audit failures return JSON 500 without personal data', async () => {
  const row = await event(otherId);
  const response = await GET(req(`?aggregate=rank&cursor=${row.id - BigInt(1)}`, { accept: 'text/event-stream' }));
  expect(response.status).toBe(200);
  const reader = response.body!.getReader();
  const frame = new TextDecoder().decode((await reader.read()).value);
  expect(frame).toContain(`id: ${row.id}\nevent: user.rank_changed`);
  expect(frame).toContain('"data":');
  await reader.cancel();
  expect(await audits(response)).toEqual([expect.objectContaining({ targetUserIds: [otherId] })]);
  const fail = vi.spyOn(prisma.apiAuditLog, 'create').mockRejectedValue(new Error('Audit unavailable'));
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const denied = await GET(req(`?aggregate=rank&cursor=${row.id - BigInt(1)}`, { accept: 'text/event-stream' }));
    expect(denied.status).toBe(500);
    expect(denied.headers.get('content-type')).toContain('application/json');
    expect(JSON.stringify(await denied.json())).not.toContain('123456789012345678');
  } finally { fail.mockRestore(); log.mockRestore(); }
});
