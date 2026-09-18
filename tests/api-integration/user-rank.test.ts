import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
const session = vi.hoisted(() => ({ userId: null as number | null }));
vi.mock('next-auth', () => ({ getServerSession: async () => session.userId === null ? null : { user: { id: String(session.userId) } } }));
vi.mock('@/app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
import { prisma } from '@/lib/prisma';
import { GET as SUMMARY } from '@/app/api/users/[id]/rank/route';
import { GET as HISTORY } from '@/app/api/users/[id]/rank-history/route';
let ownerId: number;
let otherId: number;
let emptyId: number;
let managerId: number;
let peerId: number;
let permissionId: number;
let rankId: number;
const context = (id: number | 'me') => ({ params: Promise.resolve({ id: String(id) }) });
const request = (id: number | 'me', resource: 'rank' | 'rank-history', query = '', token?: string) => new Request(`http://localhost/api/users/${id}/${resource}${query}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
const audits = (response: Response) => prisma.apiAuditLog.findMany({ where: { correlationId: response.headers.get('X-Request-Id')! } });
const privateReason = 'Private user-rank decline reason';
const privateNote = 'Private user-rank internal note';
async function history(userId: number, newRankName: string, createdAt: Date) {
  return prisma.rankHistory.create({ data: { userId, previousRankName: 'Previous fixture rank', newRankName, attendanceTotalAtChange: 12, attendanceDeltaSinceLastRank: 9, triggeredBy: 'manual', triggeredByUserId: managerId, triggeredByDiscordId: '910000000000000001', outcome: 'declined', declineReason: privateReason, note: privateNote, createdAt } });
}
beforeAll(async () => {
  if (!process.env.API_INTEGRATION_DATABASE_URL || process.env.DATABASE_URL !== process.env.API_INTEGRATION_DATABASE_URL) throw new Error('Isolated Prisma integration database required.');
  permissionId = (await prisma.permission.upsert({ where: { key: 'user:manage' }, create: { key: 'user:manage' }, update: {} })).id;
  ownerId = (await prisma.user.create({ data: { username: 'User rank integration owner' } })).id;
  otherId = (await prisma.user.create({ data: { username: 'User rank integration other' } })).id;
  emptyId = (await prisma.user.create({ data: { username: 'User rank integration empty' } })).id;
  managerId = (await prisma.user.create({ data: { username: 'User rank integration manager', userPermissions: { create: { permissionId, value: 10 } } } })).id;
  peerId = (await prisma.user.create({ data: { username: 'User rank integration peer', userPermissions: { create: { permissionId, value: 10 } } } })).id;
  rankId = (await prisma.rank.create({ data: { name: 'User rank integration fixture', abbreviation: 'URIF', orderIndex: 14000 } })).id;
  await prisma.userRank.create({ data: { userId: ownerId, currentRankId: rankId, interviewDone: true, attendanceSinceLastRank: 3, lastRankedUpAt: new Date('2026-09-17T10:00:00Z') } });
  await prisma.userRank.create({ data: { userId: otherId, currentRankId: null } });
  await prisma.userRank.create({ data: { userId: peerId, currentRankId: rankId } });
});
beforeEach(() => { session.userId = ownerId; });
afterAll(async () => { await prisma.$disconnect(); });

test('rank summary uses actual main-operation attendance statuses and applied legacy totals with UTC dates', async () => {
  const main = await prisma.orbat.create({ data: { name: 'User rank main operation', isMainOp: true, createdById: managerId } });
  const side = await prisma.orbat.create({ data: { name: 'User rank side operation', isSideOp: true, createdById: managerId } });
  for (const status of ['present', 'late', 'gone_early', 'partial', 'absent'] as const) {
    const operation = status === 'present' ? main : await prisma.orbat.create({ data: { name: `User rank main ${status}`, isMainOp: true, createdById: managerId } });
    await prisma.attendance.create({ data: { userId: ownerId, orbatId: operation.id, status } });
  }
  await prisma.attendance.create({ data: { userId: ownerId, orbatId: side.id, status: 'present' } });
  await prisma.attendance.create({ data: { userId: otherId, orbatId: main.id, status: 'present' } });
  await prisma.legacyAttendanceData.create({ data: { legacyName: 'User rank legacy present', legacyStatus: 'P', mappedUserId: ownerId } });
  await prisma.legacyAttendanceData.create({ data: { legacyName: 'User rank legacy absent', legacyStatus: 'A', mappedUserId: ownerId } });
  for (const [isApplied, oldData] of [[true, 7], [false, 99], [true, 0]] as const) await prisma.legacyUserData.create({ data: { legacyId: `user-rank-${isApplied}-${oldData}`, discordUsername: 'User rank fixture legacy', rankName: 'Legacy', tigSinceLastPromo: 0, totalTig: 0, oldData, isApplied, mappedUserId: ownerId } });
  const response = await SUMMARY(request('me', 'rank'), context('me'));
  expect(response.status).toBe(200);
  const data = (await response.json()).data;
  expect(data).toMatchObject({ userId: ownerId, currentRank: { id: rankId }, retired: false, interviewDone: true, attendanceSinceLastRank: 3, attendanceTotal: 12, attendanceDelta: 9, lastRankedUpAt: '2026-09-17T10:00:00.000Z' });
  expect(data.currentRank.createdAt).toMatch(/Z$/);
  expect(await audits(response)).toEqual([]);
});

test('rank history is scoped by user and descending id, returns only the website DTO, and rejects legacy pages', async () => {
  const first = await history(ownerId, 'Owner rank first', new Date('2026-09-17T10:00:00Z'));
  const second = await history(ownerId, 'Owner rank second', new Date('2026-01-01T10:00:00Z'));
  await history(otherId, 'Other user private rank', new Date('2026-09-18T10:00:00Z'));
  const response = await HISTORY(request('me', 'rank-history', '?limit=1'), context('me'));
  expect(response.status).toBe(200);
  const page = await response.json();
  expect(page.data.map((row: { id: number }) => row.id)).toEqual([second.id]);
  expect(page.meta.nextCursor).toBe(String(second.id));
  expect(Object.keys(page.data[0]).sort()).toEqual(['id', 'previousRankName', 'newRankName', 'attendanceTotalAtChange', 'attendanceDeltaSinceLastRank', 'triggeredBy', 'outcome', 'declineReason', 'createdAt'].sort());
  expect(page.data[0].declineReason).toBe(privateReason);
  expect(page.data[0].createdAt).toBe('2026-01-01T10:00:00.000Z');
  expect(JSON.stringify(page)).not.toContain(privateNote);
  expect(JSON.stringify(page)).not.toContain('Other user private rank');
  const next = await (await HISTORY(request('me', 'rank-history', `?limit=1&cursor=${second.id}`), context('me'))).json();
  expect(next.data.map((row: { id: number }) => row.id)).toEqual([first.id]);
  expect(next.meta.nextCursor).toBeNull();
  expect(await audits(response)).toEqual([]);
  expect((await HISTORY(request('me', 'rank-history', '?page=1'), context('me'))).status).toBe(400);
});

test('missing rank records return 404 without invented summary defaults while existing empty history stays empty', async () => {
  session.userId = emptyId;
  expect((await SUMMARY(request('me', 'rank'), context('me'))).status).toBe(404);
  const empty = await HISTORY(request('me', 'rank-history'), context('me'));
  expect(empty.status).toBe(200);
  expect((await empty.json()).data).toEqual([]);
  expect(await audits(empty)).toEqual([]);
  session.userId = otherId;
  const unranked = await SUMMARY(request('me', 'rank'), context('me'));
  expect(unranked.status).toBe(200);
  expect((await unranked.json()).data.currentRank).toBeNull();
  session.userId = managerId;
  expect((await SUMMARY(request(2_000_000_000, 'rank'), context(2_000_000_000))).status).toBe(404);
  expect((await HISTORY(request(2_000_000_000, 'rank-history'), context(2_000_000_000))).status).toBe(404);
});

test('rank reads enforce ownership and live hierarchy; permitted other-user and empty-history reads audit identities only', async () => {
  expect((await SUMMARY(request(otherId, 'rank'), context(otherId))).status).toBe(403);
  expect((await HISTORY(request(otherId, 'rank-history'), context(otherId))).status).toBe(403);
  session.userId = managerId;
  for (const [resource, handler] of [['rank', SUMMARY], ['rank-history', HISTORY]] as const) {
    const response = await handler(request(ownerId, resource), context(ownerId));
    expect(response.status).toBe(200);
    const rows = await audits(response);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actorUserId: managerId, action: 'user_data.read', targetUserIds: [ownerId], method: 'GET', path: `/api/users/${ownerId}/${resource}`, before: null, after: null });
    expect(JSON.stringify(rows)).not.toContain(privateReason);
    expect(JSON.stringify(rows)).not.toContain(privateNote);
    expect((await handler(request(peerId, resource), context(peerId))).status).toBe(403);
  }
  const empty = await HISTORY(request(emptyId, 'rank-history'), context(emptyId));
  expect(empty.status).toBe(200);
  expect((await empty.json()).data).toEqual([]);
  expect((await audits(empty))[0]).toMatchObject({ targetUserIds: [emptyId], before: null, after: null });
  await prisma.userPermission.update({ where: { userId_permissionId: { userId: managerId, permissionId } }, data: { value: 0 } });
  try {
    expect((await SUMMARY(request(ownerId, 'rank'), context(ownerId))).status).toBe(403);
    expect((await HISTORY(request(ownerId, 'rank-history'), context(ownerId))).status).toBe(403);
  } finally { await prisma.userPermission.update({ where: { userId_permissionId: { userId: managerId, permissionId } }, data: { value: 10 } }); }
});

test('active bots can read numeric user ranks but cannot use me or fall back to sessions with invalid credentials', async () => {
  const bot = await prisma.botToken.create({ data: { name: 'User rank integration bot', token: 'user-rank-integration-token' } });
  session.userId = null;
  for (const [resource, handler] of [['rank', SUMMARY], ['rank-history', HISTORY]] as const) {
    expect((await handler(request('me', resource), context('me'))).status).toBe(401);
    expect((await handler(request('me', resource, '', bot.token), context('me'))).status).toBe(400);
    const response = await handler(request(ownerId, resource, '', bot.token), context(ownerId));
    expect(response.status).toBe(200);
    expect((await audits(response))[0]).toMatchObject({ actorType: 'bot', actorTokenId: bot.id, targetUserIds: [ownerId], before: null, after: null });
  }
  const empty = await HISTORY(request(emptyId, 'rank-history', '', bot.token), context(emptyId));
  expect(empty.status).toBe(200);
  expect((await empty.json()).data).toEqual([]);
  expect((await audits(empty))[0]).toMatchObject({ actorType: 'bot', actorTokenId: bot.id, targetUserIds: [emptyId], before: null, after: null });
  await prisma.botToken.update({ where: { id: bot.id }, data: { isActive: false } });
  session.userId = ownerId;
  for (const token of [bot.token, 'invalid-user-rank-token']) {
    expect((await SUMMARY(request('me', 'rank', '', token), context('me'))).status).toBe(401);
    expect((await HISTORY(request('me', 'rank-history', '', token), context('me'))).status).toBe(401);
  }
});

test('required rank read audits fail closed without exposing fetched rank or history data', async () => {
  session.userId = managerId;
  const auditSpy = vi.spyOn(prisma.apiAuditLog, 'create').mockRejectedValue(new Error('Audit storage unavailable'));
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    for (const [resource, handler] of [['rank', SUMMARY], ['rank-history', HISTORY]] as const) {
      const response = await handler(request(ownerId, resource), context(ownerId));
      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body.error.code).toBe('internal_error');
      expect(body.data).toBeUndefined();
      expect(JSON.stringify(body)).not.toContain('Owner rank');
      expect(JSON.stringify(body)).not.toContain('User rank integration fixture');
      expect(JSON.stringify(body)).not.toContain(privateReason);
      expect(JSON.stringify(body)).not.toContain(privateNote);
    }
  } finally { auditSpy.mockRestore(); log.mockRestore(); }
});
