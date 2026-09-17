import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';

const session = vi.hoisted(() => ({ userId: null as number | null }));
vi.mock('next-auth', () => ({ getServerSession: async () => session.userId === null ? null : { user: { id: String(session.userId) } } }));
vi.mock('@/app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));

import { prisma } from '@/lib/prisma';
import type { Prisma } from '@/generated/prisma/client';
import { writeApiAudit } from '@/lib/api/audit';
import { GET as listTokens, POST as createToken } from '@/app/api/bot-tokens/route';
import { GET as getToken, PATCH as patchToken, DELETE as deleteToken } from '@/app/api/bot-tokens/[id]/route';
import { GET as getPreferences, PATCH as patchPreferences } from '@/app/api/users/[id]/notification-preferences/route';

let adminId: number;
let userId: number;
const context = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) });
function request(path: string, method = 'GET', body?: unknown, token?: string) {
  return new Request(`http://localhost/api/${path}`, {
    method, headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

beforeAll(async () => {
  if (!process.env.API_INTEGRATION_DATABASE_URL || process.env.DATABASE_URL !== process.env.API_INTEGRATION_DATABASE_URL) {
    throw new Error('Run integration tests through scripts/test-api-integration.mjs with its isolated Prisma database.');
  }
  const permission = await prisma.permission.create({ data: { key: 'system:super_admin' } });
  const admin = await prisma.user.create({ data: { username: 'Integration administrator', userPermissions: { create: { permissionId: permission.id, value: 255 } } } });
  const user = await prisma.user.create({ data: { username: 'Integration member' } });
  adminId = admin.id;
  userId = user.id;
});
beforeEach(() => { session.userId = adminId; });
afterAll(async () => { await prisma.$disconnect(); });

test('token lifecycle persists mutations, redacts reads, records audits, and rejects revoked/deleted credentials', async () => {
  const createdResponse = await createToken(request('bot-tokens', 'POST', { name: 'Integration bot' }));
  expect(createdResponse.status).toBe(201);
  const { data: created } = await createdResponse.json();
  expect(created.token).toMatch(/^[a-f0-9]{64}$/);
  expect(created.createdAt).toMatch(/Z$/);
  expect(await prisma.botToken.findUnique({ where: { id: created.id } })).toMatchObject({ createdById: adminId, token: created.token });
  const audit = await prisma.apiAuditLog.findFirstOrThrow({ where: { correlationId: createdResponse.headers.get('X-Request-Id')! } });
  expect(audit).toMatchObject({ actorType: 'user', actorUserId: adminId, action: 'bot_token.created', after: { name: 'Integration bot', isActive: true } });
  expect(JSON.stringify(audit)).not.toContain(created.token);

  session.userId = null;
  const listed = await listTokens(request('bot-tokens', 'GET', undefined, created.token));
  expect(listed.status).toBe(200);
  expect(JSON.stringify(await listed.json())).not.toContain(created.token);
  expect((await prisma.botToken.findUniqueOrThrow({ where: { id: created.id } })).lastUsedAt).toBeInstanceOf(Date);
  const detail = await getToken(request(`bot-tokens/${created.id}`, 'GET', undefined, created.token), context(created.id));
  expect(detail.status).toBe(200);
  expect((await detail.json()).data.token).toBeUndefined();

  const revoked = await patchToken(request(`bot-tokens/${created.id}`, 'PATCH', { isActive: false }, created.token), context(created.id));
  expect(revoked.status).toBe(200);
  session.userId = adminId;
  const denied = await listTokens(request('bot-tokens', 'GET', undefined, created.token));
  expect(denied.status).toBe(401); // Explicit invalid bearer cannot fall back to administrator session.
  expect(await prisma.apiAuditLog.findFirst({ where: { correlationId: denied.headers.get('X-Request-Id')!, action: 'access.denied' } })).not.toBeNull();

  expect((await deleteToken(request(`bot-tokens/${created.id}`, 'DELETE'), context(created.id))).status).toBe(200);
  expect(await prisma.botToken.findUnique({ where: { id: created.id } })).toBeNull();
  expect((await listTokens(request('bot-tokens', 'GET', undefined, created.token))).status).toBe(401);
});

test('preference reads audit other users and bots, exclude self reads, and persist user/bot patches', async () => {
  session.userId = userId;
  const self = await getPreferences(request('users/me/notification-preferences'), context('me'));
  expect(self.status).toBe(200);
  const selfPayload = await self.json();
  expect(selfPayload.data.dmEnabled).toBe(true);
  expect(selfPayload.data.id).toBeUndefined();
  expect(selfPayload.data.userId).toBeUndefined();
  expect(await prisma.userNotificationPreference.findUnique({ where: { userId } })).toBeNull();
  expect(await prisma.apiAuditLog.count({ where: { correlationId: self.headers.get('X-Request-Id')! } })).toBe(0);
  const selfPatch = await patchPreferences(request('users/me/notification-preferences', 'PATCH', { trainingScheduled: true }), context('me'));
  expect(selfPatch.status).toBe(200);
  const patched = (await selfPatch.json()).data;
  expect(patched.dmEnabled).toBe(true);
  for (const field of ['id', 'userId', 'createdAt', 'updatedAt']) expect(patched[field]).toBeUndefined();
  expect((await prisma.userNotificationPreference.findUniqueOrThrow({ where: { userId } })).trainingScheduled).toBe(true);

  session.userId = adminId;
  const other = await getPreferences(request(`users/${userId}/notification-preferences`), context(userId));
  expect(other.status).toBe(200);
  expect(await prisma.apiAuditLog.findFirstOrThrow({ where: { correlationId: other.headers.get('X-Request-Id')! } })).toMatchObject({ action: 'user_data.read', actorUserId: adminId, targetUserIds: [userId], before: null, after: null });
  const bot = await prisma.botToken.create({ data: { name: 'Preference bot', token: 'isolated-preference-bot' } });
  session.userId = null;
  const botRead = await getPreferences(request(`users/${userId}/notification-preferences`, 'GET', undefined, bot.token), context(userId));
  expect(botRead.status).toBe(200);
  expect(await prisma.apiAuditLog.findFirstOrThrow({ where: { correlationId: botRead.headers.get('X-Request-Id')! } })).toMatchObject({ actorType: 'bot', actorTokenId: bot.id, targetUserIds: [userId] });
  const botPatch = await patchPreferences(request(`users/${userId}/notification-preferences`, 'PATCH', { trainingScheduled: false }, bot.token), context(userId));
  expect(botPatch.status).toBe(200);
  expect(await prisma.apiAuditLog.findFirstOrThrow({ where: { correlationId: botPatch.headers.get('X-Request-Id')! } })).toMatchObject({ before: { trainingScheduled: true }, after: { trainingScheduled: false } });
});

test('ordinary users cannot manage another user or bot tokens and failed validation leaves data unchanged', async () => {
  session.userId = userId;
  expect((await listTokens(request('bot-tokens'))).status).toBe(403);
  expect((await getPreferences(request(`users/${adminId}/notification-preferences`), context(adminId))).status).toBe(403);
  const before = await prisma.userNotificationPreference.findUnique({ where: { userId } });
  const invalid = await patchPreferences(request('users/me/notification-preferences', 'PATCH', { trainingScheduled: 'yes' }), context('me'));
  expect(invalid.status).toBe(422);
  expect(await prisma.userNotificationPreference.findUnique({ where: { userId } })).toEqual(before);
});

test('Prisma transactions roll back both mutation and audit records', async () => {
  const correlationId = 'integration-rollback';
  await expect(prisma.$transaction(async tx => {
    const created = await tx.botToken.create({ data: { name: 'Rollback bot', token: 'isolated-rollback-bot' } });
    await writeApiAudit(tx, {
      principal: { kind: 'user', userId: adminId, permissions: { 'system:super_admin': 255 } },
      correlationId, method: 'POST', path: '/api/bot-tokens',
    }, { action: 'bot_token.created', resource: 'bot_token', resourceId: String(created.id), outcome: 'success', after: { name: created.name } });
    throw new Error('Deliberate transaction rollback');
  })).rejects.toThrow('Deliberate transaction rollback');
  expect(await prisma.botToken.count({ where: { token: 'isolated-rollback-bot' } })).toBe(0);
  expect(await prisma.apiAuditLog.count({ where: { correlationId } })).toBe(0);
});

test('database enforces preference ownership foreign keys and unique bot credentials', async () => {
  await expect(prisma.userNotificationPreference.create({ data: { userId: 2_000_000_000 } })).rejects.toMatchObject({ code: 'P2003' });
  await prisma.botToken.create({ data: { name: 'Unique bot', token: 'isolated-unique-token' } });
  await expect(prisma.botToken.create({ data: { name: 'Duplicate bot', token: 'isolated-unique-token' } })).rejects.toMatchObject({ code: 'P2002' });
});

test('token endpoint fails closed and rolls back the real mutation when audit persistence fails', async () => {
  const transact = prisma.$transaction.bind(prisma);
  // Inject only an audit-write outage; keep the transaction and token write on PGlite.
  const transactionSpy = vi.spyOn(prisma, '$transaction').mockImplementation((
    (operation: (tx: Prisma.TransactionClient) => Promise<unknown>) => transact(async tx => {
      const auditSpy = vi.spyOn(tx.apiAuditLog, 'create').mockRejectedValue(new Error('Audit storage unavailable'));
      try { return await operation(tx); }
      finally { auditSpy.mockRestore(); }
    })
  ) as typeof prisma.$transaction);
  let response: Response;
  try {
    response = await createToken(request('bot-tokens', 'POST', { name: 'Audit outage bot' }));
  } finally {
    transactionSpy.mockRestore();
  }
  expect(response.status).toBe(500);
  expect((await response.json()).error.code).toBe('internal_error');
  expect(await prisma.botToken.count({ where: { name: 'Audit outage bot' } })).toBe(0);
  expect(await prisma.apiAuditLog.count({ where: { correlationId: response.headers.get('X-Request-Id')! } })).toBe(0);
});
