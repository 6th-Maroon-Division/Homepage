import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { NextRequest } from 'next/server';
const session = vi.hoisted(() => ({ userId: null as number | null }));
vi.mock('next-auth', () => ({ getServerSession: async () => session.userId === null ? null : { user: { id: String(session.userId) } } }));
vi.mock('next-auth/next', () => ({ getServerSession: async () => session.userId === null ? null : { user: { id: String(session.userId) } } }));
vi.mock('@/app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
import { prisma } from '@/lib/prisma';
import { GET } from '@/app/api/orbats/route';
let userId: number;
let deletedUserId: number;
let token: string;
let tokenId: number;
let deletedCursorId: number;
let fixtures: { id: number; name: string }[];
const request = (query = '', authorization?: string) => new NextRequest(`http://localhost/api/orbats${query}`, { headers: authorization ? { authorization } : {} });
const audits = (response: Response) => prisma.apiAuditLog.findMany({ where: { correlationId: response.headers.get('X-Request-Id')! } });
beforeAll(async () => {
  if (!process.env.API_INTEGRATION_DATABASE_URL || process.env.DATABASE_URL !== process.env.API_INTEGRATION_DATABASE_URL) throw new Error('Isolated Prisma integration database required.');
  userId = (await prisma.user.create({ data: { username: 'Public ORBAT list member' } })).id;
  deletedUserId = (await prisma.user.create({ data: { username: 'Public ORBAT list deleted member' } })).id;
  await prisma.user.delete({ where: { id: deletedUserId } });
  const bot = await prisma.botToken.create({ data: { name: 'Public ORBAT list bot', token: 'public-orbat-list-integration-token' } });
  token = bot.token; tokenId = bot.id;
  await prisma.orbat.createMany({ data: Array.from({ length: 101 }, (_, index) => ({ name: `Public list operation ${index}`, createdById: userId, description: 'Private list description omitted', createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, 101 - index)), startsAtUtc: new Date('2026-10-01T12:00:00Z'), isSideOp: true })) });
  fixtures = await prisma.orbat.findMany({ where: { createdById: userId }, select: { id: true, name: true }, orderBy: { id: 'desc' } });
  deletedCursorId = (await prisma.orbat.create({ data: { name: 'Deleted public list cursor', createdById: userId } })).id;
  await prisma.orbat.delete({ where: { id: deletedCursorId } });
});
beforeEach(() => { session.userId = null; });
afterAll(async () => {
  try { if (userId) await prisma.orbat.deleteMany({ where: { createdById: userId } }); }
  finally { await prisma.$disconnect(); }
});

test('anonymous session and bot receive identical minimal public rows without personal-read audits', async () => {
  for (const identity of ['anonymous', 'member', 'bot', 'deleted-session']) {
    session.userId = identity === 'member' ? userId : identity === 'deleted-session' ? deletedUserId : null;
    const response = await GET(request('?limit=2', identity === 'bot' ? `Bearer ${token}` : undefined));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toEqual(fixtures.slice(0, 2));
    expect(body.meta).toEqual({ limit: 2, nextCursor: String(fixtures[1].id) });
    for (const row of body.data) expect(Object.keys(row).sort()).toEqual(['id', 'name']);
    expect(JSON.stringify(body)).not.toContain('Private list description');
    expect(await audits(response)).toEqual([]);
  }
});

test('list uses descending IDs rather than creation timestamps and accepts deleted cursor records as ranges', async () => {
  const first = await (await GET(request('?limit=2'))).json();
  const second = await (await GET(request(`?limit=2&cursor=${first.meta.nextCursor}`))).json();
  expect([...first.data, ...second.data]).toEqual(fixtures.slice(0, 4));
  const dates = await prisma.orbat.findMany({ where: { id: { in: fixtures.slice(0, 2).map(row => row.id) } }, orderBy: { id: 'desc' }, select: { createdAt: true } });
  expect(dates[0].createdAt.getTime()).toBeLessThan(dates[1].createdAt.getTime());
  const deleted = await (await GET(request(`?limit=2&cursor=${deletedCursorId}`))).json();
  expect(deleted.data).toEqual(first.data);
  expect(deleted.meta).toEqual(first.meta);
});

test('pagination has real lookahead defaults and maximum cap with a null final cursor for exactly full pages', async () => {
  const defaults = await (await GET(request())).json();
  expect(defaults.data).toEqual(fixtures.slice(0, 50));
  expect(defaults.meta).toEqual({ limit: 50, nextCursor: String(fixtures[49].id) });
  const capped = await (await GET(request('?limit=101'))).json();
  expect(capped.data).toEqual(fixtures.slice(0, 100));
  expect(capped.meta).toEqual({ limit: 100, nextCursor: String(fixtures[99].id) });
  const oldest = await prisma.orbat.findMany({ orderBy: { id: 'asc' }, take: 3, select: { id: true, name: true } });
  const final = await (await GET(request(`?cursor=${oldest[2].id}&limit=2`))).json();
  expect(final.data).toEqual([oldest[1], oldest[0]]);
  expect(final.meta).toEqual({ limit: 2, nextCursor: null });
  const empty = await GET(request(`?cursor=${oldest[0].id}&limit=2`));
  expect(await empty.json()).toMatchObject({ data: [], meta: { limit: 2, nextCursor: null } });
  expect(await audits(empty)).toEqual([]);
});

test('explicit invalid malformed and revoked bot credentials reject even with a valid session', async () => {
  session.userId = userId;
  await prisma.botToken.update({ where: { id: tokenId }, data: { isActive: false } });
  try {
    for (const authorization of [`Bearer ${token}`, 'Bearer nonexistent-list-token', 'Basic invalid', 'Bearer invalid token']) {
      const response = await GET(request('', authorization));
      expect(response.status).toBe(401);
      expect((await response.json()).data).toBeUndefined();
      const denied = await audits(response);
      expect(denied).toHaveLength(1);
      expect(denied[0]).toMatchObject({ action: 'access.denied', outcome: 'denied', actorType: 'anonymous', actorUserId: null, actorTokenId: null, targetUserIds: [], before: null, after: null });
    }
  } finally { await prisma.botToken.update({ where: { id: tokenId }, data: { isActive: true } }); }
});

test('strict list query validation rejects unknown duplicates and invalid numeric cursor values', async () => {
  for (const query of ['?page=1', '?activeOnly=true', '?limit=1&limit=2', '?cursor=1&cursor=2', '?cursor=0', '?cursor=-1', '?cursor=1.5', '?cursor=2147483648', '?cursor=orbat:1', '?limit=0', '?limit=oops']) {
    const response = await GET(request(query));
    expect(response.status).toBe(400);
    expect((await response.json()).data).toBeUndefined();
  }
});
