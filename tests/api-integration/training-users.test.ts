import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
const session = vi.hoisted(() => ({ userId: null as number | null }));
vi.mock('next-auth', () => ({ getServerSession: async () => session.userId === null ? null : { user: { id: String(session.userId) } } }));
vi.mock('@/app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
import { prisma } from '@/lib/prisma';
import { GET } from '@/app/api/training-users/route';
let actorId: number;
let approverId: number;
let markerId: number;
let superadminId: number;
let zeroId: number;
let ordinaryId: number;
let markPermissionId: number;
let approvePermissionId: number;
const request = (query = '', token?: string) => new Request(`http://localhost/api/training-users${query}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
const queryAfterActor = (extra = '') => actorId > 1 ? `?cursor=${actorId - 1}${extra}` : extra ? `?${extra.slice(1)}` : '';
const requestAudits = (response: Response) => prisma.apiAuditLog.findMany({ where: { correlationId: response.headers.get('X-Request-Id')! } });
beforeAll(async () => {
  if (!process.env.API_INTEGRATION_DATABASE_URL || process.env.DATABASE_URL !== process.env.API_INTEGRATION_DATABASE_URL) throw new Error('Isolated Prisma integration database required.');
  const permission = async (key: string) => prisma.permission.upsert({ where: { key }, create: { key }, update: {} });
  markPermissionId = (await permission('training:mark')).id;
  approvePermissionId = (await permission('training:approve_request')).id;
  const superPermissionId = (await permission('system:super_admin')).id;
  const user = async (username: string, permissionId?: number, value = 1) => (await prisma.user.create({ data: {
    username, email: `${username.replaceAll(' ', '-')}@example.test`, avatarUrl: `https://example.test/${username.replaceAll(' ', '-')}.png`,
    ...(permissionId === undefined ? {} : { userPermissions: { create: { permissionId, value } } }),
  } })).id;
  // Sequential fixtures make exact returned/lookahead identities independent of
  // fixtures created by other integration files, using the starting cursor.
  actorId = await user('Training directory actor', markPermissionId);
  approverId = await user('Training directory approver', approvePermissionId);
  markerId = await user('Training directory marker', markPermissionId);
  superadminId = await user('Training directory superadmin', superPermissionId);
  zeroId = await user('Training directory zero', markPermissionId, 0);
  ordinaryId = await user('Training directory ordinary');
});
beforeEach(() => { session.userId = actorId; });
afterAll(async () => { await prisma.$disconnect(); });

test('training directory returns only its public DTO and evaluates positive staff grants rather than permission-row existence', async () => {
  const response = await GET(request(queryAfterActor('&limit=100')));
  expect(response.status).toBe(200);
  const { data, meta } = await response.json();
  expect(data.map((user: { id: number }) => user.id)).toEqual([actorId, approverId, markerId, superadminId, zeroId, ordinaryId]);
  expect(data.map((user: { isTrainer: boolean }) => user.isTrainer)).toEqual([true, true, true, true, false, false]);
  for (const user of data) expect(Object.keys(user).sort()).toEqual(['avatarUrl', 'id', 'isTrainer', 'username']);
  expect(JSON.stringify(data)).not.toContain('@example.test');
  expect(meta.nextCursor).toBeNull();
});

test('staffOnly filtering happens before pagination and uses actual lookahead for nextCursor', async () => {
  const page = await (await GET(request(queryAfterActor('&staffOnly=true&limit=2')))).json();
  expect(page.data.map((user: { id: number }) => user.id)).toEqual([actorId, approverId]);
  expect(page.meta.nextCursor).toBe(String(approverId));
  const next = await (await GET(request(`?cursor=${approverId}&staffOnly=true&limit=2`))).json();
  expect(next.data.map((user: { id: number }) => user.id)).toEqual([markerId, superadminId]);
  expect(next.meta.nextCursor).toBeNull();
  const ordinary = await (await GET(request(`?cursor=${superadminId}&staffOnly=false&limit=1`))).json();
  expect(ordinary.data.map((user: { id: number }) => user.id)).toEqual([zeroId]);
  expect(ordinary.data[0].isTrainer).toBe(false);
  expect(ordinary.meta.nextCursor).toBe(String(zeroId));
});

test('mixed user reads audit only returned other users, excluding the actor and lookahead; self-only and empty reads have no audit', async () => {
  const mixed = await GET(request(queryAfterActor('&limit=2')));
  expect(mixed.status).toBe(200);
  const audits = await requestAudits(mixed);
  expect(audits).toHaveLength(1);
  expect(audits[0]).toMatchObject({ actorType: 'user', actorUserId: actorId, action: 'user_data.read', resource: 'training_user', targetUserIds: [approverId], method: 'GET', path: '/api/training-users', before: null, after: null });
  expect(audits[0].targetUserIds).not.toContain(markerId);
  expect(JSON.stringify(audits)).not.toContain('Training directory');
  const self = await GET(request(queryAfterActor('&limit=1')));
  expect((await self.json()).data.map((user: { id: number }) => user.id)).toEqual([actorId]);
  expect(await requestAudits(self)).toEqual([]);
  const empty = await GET(request(`?cursor=${ordinaryId}&limit=1`));
  expect((await empty.json()).data).toEqual([]);
  expect(await requestAudits(empty)).toEqual([]);
});

test('bot directory reads audit every returned user and exclude lookahead records', async () => {
  const bot = await prisma.botToken.create({ data: { name: 'Training directory audit bot', token: 'training-directory-audit-token' } });
  session.userId = null;
  const response = await GET(request(queryAfterActor('&limit=2'), bot.token));
  expect(response.status).toBe(200);
  expect((await response.json()).data.map((user: { id: number }) => user.id)).toEqual([actorId, approverId]);
  const audits = await requestAudits(response);
  expect(audits).toHaveLength(1);
  expect(audits[0]).toMatchObject({ actorType: 'bot', actorTokenId: bot.id, targetUserIds: [actorId, approverId], before: null, after: null });
  expect(audits[0].targetUserIds).not.toContain(markerId);
  const empty = await GET(request(`?cursor=${ordinaryId}`, bot.token));
  expect(empty.status).toBe(200);
  expect(await requestAudits(empty)).toEqual([]);
});

test('staff eligibility immediately reflects revoked permission values in both filtered and all-user responses', async () => {
  await prisma.userPermission.update({ where: { userId_permissionId: { userId: approverId, permissionId: approvePermissionId } }, data: { value: 0 } });
  try {
    const all = await (await GET(request(queryAfterActor('&limit=100')))).json();
    expect(all.data.find((user: { id: number }) => user.id === approverId).isTrainer).toBe(false);
    const staff = await (await GET(request(queryAfterActor('&staffOnly=true&limit=100')))).json();
    expect(staff.data.map((user: { id: number }) => user.id)).toEqual([actorId, markerId, superadminId]);
  } finally {
    await prisma.userPermission.update({ where: { userId_permissionId: { userId: approverId, permissionId: approvePermissionId } }, data: { value: 1 } });
  }
});

test('directory access accepts each positive staff grant, rejects zero/missing grants, and prevents revoked bearer session fallback', async () => {
  for (const userId of [actorId, approverId, markerId, superadminId]) {
    session.userId = userId;
    expect((await GET(request(`?cursor=${ordinaryId}`))).status).toBe(200);
  }
  for (const userId of [zeroId, ordinaryId]) {
    session.userId = userId;
    expect((await GET(request())).status).toBe(403);
  }
  session.userId = null;
  expect((await GET(request())).status).toBe(401);
  session.userId = actorId;
  await prisma.userPermission.update({ where: { userId_permissionId: { userId: actorId, permissionId: markPermissionId } }, data: { value: 0 } });
  try { expect((await GET(request())).status).toBe(403); }
  finally { await prisma.userPermission.update({ where: { userId_permissionId: { userId: actorId, permissionId: markPermissionId } }, data: { value: 1 } }); }
  const bot = await prisma.botToken.create({ data: { name: 'Training directory revoked bot', token: 'training-directory-revoked-token', isActive: false } });
  for (const token of [bot.token, 'training-directory-invalid-token']) expect((await GET(request('', token))).status).toBe(401);
});

test('a required read audit failure returns a generic error without exposing the already-fetched user data', async () => {
  const auditSpy = vi.spyOn(prisma.apiAuditLog, 'create').mockRejectedValue(new Error('Audit storage unavailable'));
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  let response: Response;
  try { response = await GET(request(queryAfterActor('&limit=2'))); }
  finally { auditSpy.mockRestore(); log.mockRestore(); }
  expect(response.status).toBe(500);
  const body = await response.json();
  expect(body.error.code).toBe('internal_error');
  expect(body.data).toBeUndefined();
  expect(JSON.stringify(body)).not.toContain('Training directory');
  expect(JSON.stringify(body)).not.toContain('@example.test');
  expect(await requestAudits(response)).toEqual([]);
});
