import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
const session = vi.hoisted(() => ({ userId: null as number | null }));
vi.mock('next-auth', () => ({ getServerSession: async () => session.userId === null ? null : { user: { id: String(session.userId) } } }));
vi.mock('@/app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
import { prisma } from '@/lib/prisma';
import type { Prisma } from '@/generated/prisma/client';
import { GET, POST } from '@/app/api/ranks/route';
import { PATCH, DELETE } from '@/app/api/ranks/[id]/route';
import { PATCH as REORDER } from '@/app/api/ranks/reorder/route';
let managerId: number;
let memberId: number;
let editPermissionId: number;
let index = 0;
const ctx = (id: number) => ({ params: Promise.resolve({ id: String(id) }) });
const request = (path = 'ranks', method = 'GET', body?: unknown, token?: string) => new Request(`http://localhost/api/${path}`, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
function payload() { index += 1; return { name: `Rank catalog integration ${index}`, abbreviation: `RCI${index}`, orderIndex: 8000 + index }; }
async function fixture() { return prisma.rank.create({ data: payload() }); }
beforeAll(async () => {
  if (!process.env.API_INTEGRATION_DATABASE_URL || process.env.DATABASE_URL !== process.env.API_INTEGRATION_DATABASE_URL) throw new Error('Isolated Prisma integration database required.');
  const permissions = await Promise.all(['rank:create', 'rank:edit', 'rank:delete'].map(key => prisma.permission.upsert({ where: { key }, create: { key }, update: {} })));
  editPermissionId = permissions.find(permission => permission.key === 'rank:edit')!.id;
  managerId = (await prisma.user.create({ data: { username: 'Rank catalog manager', userPermissions: { create: permissions.map(permission => ({ permissionId: permission.id, value: 1 })) } } })).id;
  memberId = (await prisma.user.create({ data: { username: 'Rank catalog member' } })).id;
});
beforeEach(() => { session.userId = managerId; });
afterAll(async () => { await prisma.$disconnect(); });

test('rank create persists strict fields and UTC dates; partial updates preserve omitted requirements', async () => {
  const body = { ...payload(), attendanceRequiredSinceLastRank: 12, autoRankupEnabled: true };
  const created = await POST(request('ranks', 'POST', body));
  expect(created.status).toBe(201);
  const data = (await created.json()).data;
  expect(data).toMatchObject(body);
  expect(data.createdAt).toMatch(/Z$/);
  expect(data.updatedAt).toMatch(/Z$/);
  expect(await prisma.rank.findUniqueOrThrow({ where: { id: data.id } })).toMatchObject(body);
  expect(await prisma.apiAuditLog.findFirstOrThrow({ where: { correlationId: created.headers.get('X-Request-Id')! } })).toMatchObject({ actorUserId: managerId, action: 'rank.created', resource: 'rank', method: 'POST', path: '/api/ranks' });
  const patch = await PATCH(request(`ranks/${data.id}`, 'PATCH', { name: `${body.name} renamed` }), ctx(data.id));
  expect(patch.status).toBe(200);
  expect((await patch.json()).data).toMatchObject({ name: `${body.name} renamed`, attendanceRequiredSinceLastRank: 12, autoRankupEnabled: true, abbreviation: body.abbreviation, orderIndex: body.orderIndex });
  expect(await prisma.apiAuditLog.findFirstOrThrow({ where: { correlationId: patch.headers.get('X-Request-Id')! } })).toMatchObject({ action: 'rank.updated', method: 'PATCH', path: `/api/ranks/${data.id}` });
  const cleared = await PATCH(request(`ranks/${data.id}`, 'PATCH', { attendanceRequiredSinceLastRank: null, autoRankupEnabled: false }), ctx(data.id));
  expect(cleared.status).toBe(200);
  expect((await cleared.json()).data).toMatchObject({ attendanceRequiredSinceLastRank: null, autoRankupEnabled: false });
});

test('rank catalog pages by database id and reads require authentication without an audit trail', async () => {
  const first = await fixture();
  const second = await fixture();
  session.userId = memberId;
  const response = await GET(request(`ranks?limit=1&cursor=${first.id - 1}`));
  const page = await response.json();
  expect(page.data.map((rank: { id: number }) => rank.id)).toEqual([first.id]);
  expect(page.meta.nextCursor).toBe(String(first.id));
  expect(await prisma.apiAuditLog.count({ where: { correlationId: response.headers.get('X-Request-Id')! } })).toBe(0);
  const next = await (await GET(request(`ranks?limit=1&cursor=${first.id}`))).json();
  expect(next.data.map((rank: { id: number }) => rank.id)).toEqual([second.id]);
  expect(next.meta.nextCursor).toBeNull();
  session.userId = null;
  expect((await GET(request())).status).toBe(401);
});

test('rank duplicate names and abbreviations conflict and invalid mutations leave stored fields intact', async () => {
  const first = await fixture();
  const second = await fixture();
  expect((await POST(request('ranks', 'POST', { ...payload(), name: first.name }))).status).toBe(409);
  expect((await POST(request('ranks', 'POST', { ...payload(), abbreviation: first.abbreviation }))).status).toBe(409);
  expect((await PATCH(request(`ranks/${second.id}`, 'PATCH', { abbreviation: first.abbreviation }), ctx(second.id))).status).toBe(409);
  for (const body of [{ orderIndex: -1 }, { attendanceRequiredSinceLastRank: 1.5 }, { autoRankupEnabled: 'true' }, { unknown: 1 }, {}]) {
    expect((await PATCH(request(`ranks/${first.id}`, 'PATCH', body), ctx(first.id))).status).toBe(422);
  }
  expect(await prisma.rank.findUniqueOrThrow({ where: { id: first.id } })).toEqual(first);
  expect(await prisma.rank.findUniqueOrThrow({ where: { id: second.id } })).toEqual(second);
  expect((await PATCH(request('ranks/2000000000', 'PATCH', { name: 'Missing' }), ctx(2_000_000_000))).status).toBe(404);
});

test('rank reorder persists all updates and audits, while missing and duplicate IDs leave every rank unchanged', async () => {
  const first = await fixture();
  const second = await fixture();
  const missing = await REORDER(request('ranks/reorder', 'PATCH', { ranks: [{ id: first.id, orderIndex: 1 }, { id: 2_000_000_000, orderIndex: 2 }] }));
  expect(missing.status).toBe(404);
  expect(await prisma.rank.findUniqueOrThrow({ where: { id: first.id } })).toEqual(first);
  expect(await prisma.apiAuditLog.count({ where: { correlationId: missing.headers.get('X-Request-Id')! } })).toBe(0);
  expect((await REORDER(request('ranks/reorder', 'PATCH', { ranks: [{ id: first.id, orderIndex: 1 }, { id: first.id, orderIndex: 2 }] }))).status).toBe(422);
  const reordered = await REORDER(request('ranks/reorder', 'PATCH', { ranks: [{ id: first.id, orderIndex: second.orderIndex }, { id: second.id, orderIndex: first.orderIndex }] }));
  expect(reordered.status).toBe(200);
  expect((await reordered.json()).data).toBeNull();
  expect((await prisma.rank.findUniqueOrThrow({ where: { id: first.id } })).orderIndex).toBe(second.orderIndex);
  expect((await prisma.rank.findUniqueOrThrow({ where: { id: second.id } })).orderIndex).toBe(first.orderIndex);
  const audits = await prisma.apiAuditLog.findMany({ where: { correlationId: reordered.headers.get('X-Request-Id')! } });
  expect(audits).toHaveLength(2);
  expect(audits).toEqual(expect.arrayContaining([expect.objectContaining({ action: 'rank.reordered', resourceId: String(first.id), method: 'PATCH', path: '/api/ranks/reorder', before: expect.objectContaining({ orderIndex: first.orderIndex }), after: expect.objectContaining({ orderIndex: second.orderIndex }) })]));
});

test('assigned ranks cannot be deleted; unassigned rank deletion applies schema cascades and records an audit', async () => {
  const rank = await fixture();
  const user = await prisma.user.create({ data: { username: 'Assigned catalog rank user' } });
  const assignment = await prisma.userRank.create({ data: { userId: user.id, currentRankId: rank.id } });
  expect((await DELETE(request(`ranks/${rank.id}`, 'DELETE'), ctx(rank.id))).status).toBe(409);
  expect(await prisma.rank.findUnique({ where: { id: rank.id } })).not.toBeNull();
  expect((await prisma.userRank.findUniqueOrThrow({ where: { id: assignment.id } })).currentRankId).toBe(rank.id);
  await prisma.userRank.update({ where: { id: assignment.id }, data: { currentRankId: null } });
  const mapping = await prisma.rankDiscordRole.create({ data: { rankId: rank.id, guildId: '890000000000000001', discordRoleId: '890000000000000002' } });
  const training = await prisma.training.create({ data: { name: 'Catalog rank training' } });
  const requirement = await prisma.trainingRankRequirement.create({ data: { trainingId: training.id, minimumRankId: rank.id } });
  const transition = await prisma.rankTransitionRequirement.create({ data: { targetRankId: rank.id, requiredTrainings: { connect: { id: training.id } } } });
  const deleted = await DELETE(request(`ranks/${rank.id}`, 'DELETE'), ctx(rank.id));
  expect(deleted.status).toBe(200);
  expect((await deleted.json()).data).toBeNull();
  expect(await prisma.rank.findUnique({ where: { id: rank.id } })).toBeNull();
  expect(await prisma.rankDiscordRole.findUnique({ where: { id: mapping.id } })).toBeNull();
  expect(await prisma.rankTransitionRequirement.findUnique({ where: { id: transition.id } })).toBeNull();
  expect((await prisma.trainingRankRequirement.findUniqueOrThrow({ where: { id: requirement.id } })).minimumRankId).toBeNull();
  expect(await prisma.training.findUnique({ where: { id: training.id } })).not.toBeNull();
  expect(await prisma.apiAuditLog.findFirstOrThrow({ where: { correlationId: deleted.headers.get('X-Request-Id')! } })).toMatchObject({ action: 'rank.deleted', method: 'DELETE', path: `/api/ranks/${rank.id}` });
  expect((await DELETE(request(`ranks/${rank.id}`, 'DELETE'), ctx(rank.id))).status).toBe(404);
});

test('rank mutation permissions refresh from the database and active bots can use every operation', async () => {
  const row = await fixture();
  session.userId = memberId;
  expect((await POST(request('ranks', 'POST', payload()))).status).toBe(403);
  expect((await PATCH(request(`ranks/${row.id}`, 'PATCH', { orderIndex: 1 }), ctx(row.id))).status).toBe(403);
  expect((await DELETE(request(`ranks/${row.id}`, 'DELETE'), ctx(row.id))).status).toBe(403);
  expect((await REORDER(request('ranks/reorder', 'PATCH', { ranks: [{ id: row.id, orderIndex: 2 }] }))).status).toBe(403);
  session.userId = managerId;
  await prisma.userPermission.update({ where: { userId_permissionId: { userId: managerId, permissionId: editPermissionId } }, data: { value: 0 } });
  try { expect((await PATCH(request(`ranks/${row.id}`, 'PATCH', { orderIndex: 1 }), ctx(row.id))).status).toBe(403); }
  finally { await prisma.userPermission.update({ where: { userId_permissionId: { userId: managerId, permissionId: editPermissionId } }, data: { value: 1 } }); }
  const bot = await prisma.botToken.create({ data: { name: 'Rank catalog bot', token: 'rank-catalog-integration-token' } });
  session.userId = null;
  expect((await GET(request('ranks', 'GET', undefined, bot.token))).status).toBe(200);
  const created = await POST(request('ranks', 'POST', payload(), bot.token));
  expect(created.status).toBe(201);
  const id = (await created.json()).data.id;
  expect((await PATCH(request(`ranks/${id}`, 'PATCH', { orderIndex: 1 }, bot.token), ctx(id))).status).toBe(200);
  expect((await REORDER(request('ranks/reorder', 'PATCH', { ranks: [{ id, orderIndex: 2 }] }, bot.token))).status).toBe(200);
  expect((await DELETE(request(`ranks/${id}`, 'DELETE', undefined, bot.token), ctx(id))).status).toBe(200);
  await prisma.botToken.update({ where: { id: bot.id }, data: { isActive: false } });
  session.userId = managerId;
  expect((await GET(request('ranks', 'GET', undefined, bot.token))).status).toBe(401);
  expect((await POST(request('ranks', 'POST', payload(), bot.token))).status).toBe(401);
});

test('rank reorder rolls back both rank changes and the first persisted audit if a later audit fails', async () => {
  const first = await fixture();
  const second = await fixture();
  const transact = prisma.$transaction.bind(prisma);
  const transactionSpy = vi.spyOn(prisma, '$transaction').mockImplementation(((operation: (tx: Prisma.TransactionClient) => Promise<unknown>) => transact(async tx => {
    const writeAudit = tx.apiAuditLog.create.bind(tx.apiAuditLog);
    let writes = 0;
    const auditSpy = vi.spyOn(tx.apiAuditLog, 'create').mockImplementation(((args: Prisma.ApiAuditLogCreateArgs) => {
      writes += 1;
      if (writes === 2) throw new Error('Second audit write unavailable');
      return writeAudit(args);
    }) as unknown as typeof tx.apiAuditLog.create);
    try { return await operation(tx); } finally { auditSpy.mockRestore(); }
  })) as typeof prisma.$transaction);
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  let response: Response;
  try { response = await REORDER(request('ranks/reorder', 'PATCH', { ranks: [{ id: first.id, orderIndex: 100 }, { id: second.id, orderIndex: 101 }] })); }
  finally { transactionSpy.mockRestore(); log.mockRestore(); }
  expect(response.status).toBe(500);
  expect(await prisma.rank.findUniqueOrThrow({ where: { id: first.id } })).toEqual(first);
  expect(await prisma.rank.findUniqueOrThrow({ where: { id: second.id } })).toEqual(second);
  expect(await prisma.apiAuditLog.count({ where: { correlationId: response.headers.get('X-Request-Id')! } })).toBe(0);
});

test('rank delete restores cascaded Discord mappings and transition requirements when audit persistence fails', async () => {
  const row = await fixture();
  const mapping = await prisma.rankDiscordRole.create({ data: { rankId: row.id, guildId: '890000000000000003', discordRoleId: '890000000000000004' } });
  const transition = await prisma.rankTransitionRequirement.create({ data: { targetRankId: row.id } });
  const transact = prisma.$transaction.bind(prisma);
  const transactionSpy = vi.spyOn(prisma, '$transaction').mockImplementation(((operation: (tx: Prisma.TransactionClient) => Promise<unknown>) => transact(async tx => {
    const auditSpy = vi.spyOn(tx.apiAuditLog, 'create').mockRejectedValue(new Error('Audit storage unavailable'));
    try { return await operation(tx); } finally { auditSpy.mockRestore(); }
  })) as typeof prisma.$transaction);
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  let response: Response;
  try { response = await DELETE(request(`ranks/${row.id}`, 'DELETE'), ctx(row.id)); }
  finally { transactionSpy.mockRestore(); log.mockRestore(); }
  expect(response.status).toBe(500);
  expect(await prisma.rank.findUniqueOrThrow({ where: { id: row.id } })).toEqual(row);
  expect(await prisma.rankDiscordRole.findUniqueOrThrow({ where: { id: mapping.id } })).toEqual(mapping);
  expect(await prisma.rankTransitionRequirement.findUniqueOrThrow({ where: { id: transition.id } })).toEqual(transition);
  expect(await prisma.apiAuditLog.count({ where: { correlationId: response.headers.get('X-Request-Id')! } })).toBe(0);
});
