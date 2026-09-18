import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
const session = vi.hoisted(() => ({ userId: null as number | null }));
vi.mock('next-auth', () => ({ getServerSession: async () => session.userId === null ? null : { user: { id: String(session.userId) } } }));
vi.mock('@/app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
import { prisma } from '@/lib/prisma';
import { GET } from '@/app/api/ranks/promotions/pending/route';
let actorId: number;
let lowId: number;
let peerId: number;
let highId: number;
let adminId: number;
let ordinaryId: number;
let permissionId: number;
let previousRankId: number;
let nextRankId: number;
let selfProposalId: number;
let lowProposalId: number;
let ordinaryProposalId: number;
let peerProposalId: number;
let highProposalId: number;
let adminProposalId: number;
const discordId = '920000000000000001';
const request = (query = '', token?: string) => new Request(`http://localhost/api/ranks/promotions/pending${query}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
const bounded = (extra = '') => `?cursor=${selfProposalId + 1}${extra}`;
const audits = (response: Response) => prisma.apiAuditLog.findMany({ where: { correlationId: response.headers.get('X-Request-Id')! } });
beforeAll(async () => {
  if (!process.env.API_INTEGRATION_DATABASE_URL || process.env.DATABASE_URL !== process.env.API_INTEGRATION_DATABASE_URL) throw new Error('Isolated Prisma integration database required.');
  permissionId = (await prisma.permission.upsert({ where: { key: 'rank:manage_promotions' }, create: { key: 'rank:manage_promotions' }, update: {} })).id;
  const superPermissionId = (await prisma.permission.upsert({ where: { key: 'system:super_admin' }, create: { key: 'system:super_admin' }, update: {} })).id;
  const user = async (username: string, permission?: number, value = 0) => (await prisma.user.create({ data: { username, email: 'pending-private@example.test', avatarUrl: 'https://example.test/private-avatar.png', ...(permission === undefined ? {} : { userPermissions: { create: { permissionId: permission, value } } }) } })).id;
  actorId = await user('Pending promotions actor', permissionId, 10);
  ordinaryId = await user('Pending promotions ordinary', permissionId, 0);
  lowId = await user('Pending promotions low', permissionId, 9);
  peerId = await user('Pending promotions peer', permissionId, 10);
  highId = await user('Pending promotions high', permissionId, 11);
  adminId = await user('Pending promotions superadmin', superPermissionId, 1);
  previousRankId = (await prisma.rank.create({ data: { name: 'Pending snapshot previous', abbreviation: 'PSP', orderIndex: 21000 } })).id;
  nextRankId = (await prisma.rank.create({ data: { name: 'Pending snapshot next', abbreviation: 'PSN', orderIndex: 21001 } })).id;
  const liveRank = await prisma.rank.create({ data: { name: 'Pending changed live rank', abbreviation: 'PCLR', orderIndex: 21002 } });
  await prisma.userRank.create({ data: { userId: lowId, currentRankId: liveRank.id } });
  await prisma.authAccount.create({ data: { userId: lowId, provider: 'discord', providerUserId: discordId } });
  await prisma.authAccount.create({ data: { userId: lowId, provider: 'steam', providerUserId: 'private-pending-steam-account' } });
  const proposal = async (userId: number) => (await prisma.promotionProposal.create({ data: { userId, currentRankId: previousRankId, nextRankId, attendanceTotalAtProposal: 12, attendanceDeltaSinceLastRank: 4, status: 'pending' } })).id;
  ordinaryProposalId = await proposal(ordinaryId);
  lowProposalId = await proposal(lowId);
  peerProposalId = await proposal(peerId);
  highProposalId = await proposal(highId);
  adminProposalId = await proposal(adminId);
  selfProposalId = await proposal(actorId);
  await prisma.promotionProposal.create({ data: { userId: ordinaryId, currentRankId: previousRankId, nextRankId: liveRank.id, attendanceTotalAtProposal: 0, attendanceDeltaSinceLastRank: 0, status: 'approved' } });
});
beforeEach(() => { session.userId = actorId; });
afterAll(async () => { await prisma.$disconnect(); });

test('pending visibility filters forbidden users before pagination without leaking proposal IDs through the cursor', async () => {
  const response = await GET(request('?limit=2'));
  expect(response.status).toBe(200);
  const page = await response.json();
  expect(page.data.map((row: { id: number }) => row.id)).toEqual([selfProposalId, lowProposalId]);
  expect(page.meta.nextCursor).toBe(String(lowProposalId));
  expect(page.data.every((row: { status: string }) => row.status === 'pending')).toBe(true);
  const next = await (await GET(request(`?cursor=${lowProposalId}&limit=1`))).json();
  expect(next.data.map((row: { id: number }) => row.id)).toEqual([ordinaryProposalId]);
  const rows = await audits(response);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ actorUserId: actorId, action: 'user_data.read', resource: 'promotion_proposal', targetUserIds: [lowId], before: null, after: null, method: 'GET', path: '/api/ranks/promotions/pending' });
  expect(rows[0].targetUserIds).not.toContain(ordinaryId);
  expect(rows[0].targetUserIds).not.toContain(actorId);
});

test('proposal DTO uses proposed rank IDs instead of the user current rank and limits user fields to Discord identity', async () => {
  const response = await GET(request(`?cursor=${lowProposalId + 1}&limit=1`));
  const row = (await response.json()).data[0];
  expect(row.id).toBe(lowProposalId);
  expect(row.currentRank).toEqual({ id: previousRankId, name: 'Pending snapshot previous', abbreviation: 'PSP' });
  expect(row.nextRank).toEqual({ id: nextRankId, name: 'Pending snapshot next', abbreviation: 'PSN' });
  expect(row.user).toEqual({ id: lowId, username: 'Pending promotions low', discordId });
  expect(row.createdAt).toMatch(/Z$/);
  expect(Object.keys(row).sort()).toEqual(['id', 'userId', 'currentRankId', 'nextRankId', 'attendanceTotalAtProposal', 'attendanceDeltaSinceLastRank', 'status', 'createdAt', 'user', 'currentRank', 'nextRank'].sort());
  expect(JSON.stringify(row)).not.toContain('pending-private@example.test');
  expect(JSON.stringify(row)).not.toContain('private-avatar');
  expect(JSON.stringify(row)).not.toContain('private-pending-steam-account');
  expect(JSON.stringify(row)).not.toContain('Pending changed live rank');
  expect(JSON.stringify(await audits(response))).not.toContain('Pending promotions low');
});

test('self-only pages emit no read audit and exact final pages advertise no next cursor', async () => {
  const self = await GET(request(bounded('&limit=1')));
  expect((await self.json()).data.map((row: { id: number }) => row.id)).toEqual([selfProposalId]);
  expect(await audits(self)).toEqual([]);
  session.userId = adminId;
  const oldest = await prisma.promotionProposal.findFirstOrThrow({ where: { status: 'pending' }, orderBy: { id: 'asc' } });
  const final = await (await GET(request(`?cursor=${oldest.id + 1}&limit=1`))).json();
  expect(final.data.map((row: { id: number }) => row.id)).toEqual([oldest.id]);
  expect(final.meta.nextCursor).toBeNull();
  const empty = await GET(request(`?cursor=${oldest.id}&limit=1`));
  expect((await empty.json()).data).toEqual([]);
  expect(await audits(empty)).toEqual([]);
});

test('visibility and global access immediately reflect current grants and privileged bots see all returned users', async () => {
  await prisma.userPermission.update({ where: { userId_permissionId: { userId: lowId, permissionId } }, data: { value: 10 } });
  try {
    const page = await (await GET(request(bounded('&limit=2')))).json();
    expect(page.data.map((row: { id: number }) => row.id)).toEqual([selfProposalId, ordinaryProposalId]);
  } finally { await prisma.userPermission.update({ where: { userId_permissionId: { userId: lowId, permissionId } }, data: { value: 9 } }); }
  session.userId = adminId;
  const all = await (await GET(request(bounded('&limit=100')))).json();
  expect(all.data.map((row: { id: number }) => row.id)).toEqual(expect.arrayContaining([selfProposalId, adminProposalId, highProposalId, peerProposalId, lowProposalId, ordinaryProposalId]));
  const bot = await prisma.botToken.create({ data: { name: 'Pending promotions bot', token: 'pending-promotions-integration-token' } });
  session.userId = null;
  const botRead = await GET(request(bounded('&limit=2'), bot.token));
  expect(botRead.status).toBe(200);
  expect((await botRead.json()).data.map((row: { id: number }) => row.id)).toEqual([selfProposalId, adminProposalId]);
  expect((await audits(botRead))[0]).toMatchObject({ actorType: 'bot', actorTokenId: bot.id, targetUserIds: [actorId, adminId], before: null, after: null });
  await prisma.botToken.update({ where: { id: bot.id }, data: { isActive: false } });
  session.userId = actorId;
  for (const token of [bot.token, 'invalid-pending-promotions-token']) expect((await GET(request('', token))).status).toBe(401);
  await prisma.userPermission.update({ where: { userId_permissionId: { userId: actorId, permissionId } }, data: { value: 0 } });
  try { expect((await GET(request())).status).toBe(403); }
  finally { await prisma.userPermission.update({ where: { userId_permissionId: { userId: actorId, permissionId } }, data: { value: 10 } }); }
  session.userId = ordinaryId;
  expect((await GET(request())).status).toBe(403);
  session.userId = null;
  expect((await GET(request())).status).toBe(401);
});

test('deleted rank references serialize as null and strict unknown or duplicate query parameters are rejected', async () => {
  const target = await prisma.user.create({ data: { username: 'Pending missing rank fixture' } });
  const proposal = await prisma.promotionProposal.create({ data: { userId: target.id, currentRankId: 2_000_000_000, nextRankId: 2_000_000_001, attendanceTotalAtProposal: 1, attendanceDeltaSinceLastRank: 1, status: 'pending' } });
  const response = await GET(request(`?cursor=${proposal.id + 1}&limit=1`));
  expect(response.status).toBe(200);
  expect((await response.json()).data[0]).toMatchObject({ id: proposal.id, currentRank: null, nextRank: null, user: { discordId: null } });
  for (const query of ['?page=1', '?limit=1&limit=2', '?cursor=1&cursor=2', '?limit=0', '?unknown=true']) expect((await GET(request(query))).status).toBe(400);
});

test('a required promotion read audit failure returns a generic error without fetched proposal data', async () => {
  const failure = vi.spyOn(prisma.apiAuditLog, 'create').mockRejectedValue(new Error('Audit storage unavailable'));
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  let response: Response;
  try { response = await GET(request(bounded('&limit=2'))); }
  finally { failure.mockRestore(); log.mockRestore(); }
  expect(response.status).toBe(500);
  const body = await response.json();
  expect(body.error.code).toBe('internal_error');
  expect(body.data).toBeUndefined();
  expect(JSON.stringify(body)).not.toContain('Pending promotions');
  expect(JSON.stringify(body)).not.toContain(discordId);
  expect(await audits(response)).toEqual([]);
});
