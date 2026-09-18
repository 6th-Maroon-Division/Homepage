import { beforeEach, expect, test, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
const m = vi.hoisted(() => ({ session: vi.fn(), db: { permission: { findUnique: vi.fn() }, userPermission: { findFirst: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), deleteMany: vi.fn(), upsert: vi.fn() }, botToken: { findFirst: vi.fn(), update: vi.fn() }, authAccount: { findUnique: vi.fn() } } }));
vi.mock('next-auth', () => ({ getServerSession: m.session }));
vi.mock('@/app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
vi.mock('@/lib/prisma', () => ({ prisma: m.db }));
import * as middleware from '@/lib/auth-middleware';
import * as utils from '@/lib/permission-utils';
import * as logic from '@/lib/permission-api-logic';
import * as permissions from '@/lib/permissions';
import { canModifyUserPermissions } from '@/lib/user-permission-guards';
import * as bots from '@/lib/bot-api';
import * as validation from '@/lib/bot-token-validation';
const grant = (key: string, value: number) => ({ permission: { key }, value });
beforeEach(() => { vi.resetAllMocks(); m.session.mockResolvedValue({ user: { id: 1 } }); m.db.userPermission.findMany.mockResolvedValue([]); m.db.permission.findUnique.mockResolvedValue({ id: 10 }); m.db.userPermission.findUnique.mockResolvedValue(null); });

test('simple permission checks always query current grants, including superadmin only lookup', async () => {
  m.db.userPermission.findFirst.mockResolvedValue(null);
  expect(await middleware.checkPermission(1, 'user:edit')).toBe(false);
  expect(m.db.userPermission.findFirst).toHaveBeenLastCalledWith(expect.objectContaining({ where: { userId: 1, permission: { key: { in: ['user:edit', 'system:super_admin'] } }, value: { gt: 0 } } }));
  m.db.userPermission.findFirst.mockResolvedValue({ id: 2 });
  expect(await middleware.checkPermission(1, 'system:super_admin')).toBe(true);
  expect(m.db.userPermission.findFirst).toHaveBeenLastCalledWith(expect.objectContaining({ where: expect.objectContaining({ permission: { key: { in: ['system:super_admin'] } } }) }));
});

test.each([
  [[], [], false], [[grant('user:edit', 4)], [], true], [[], [grant('user:edit', 4)], false],
  [[grant('user:edit', 4)], [grant('user:edit', 4)], false],
  [[grant('system:super_admin', 1)], [grant('system:super_admin', 255)], true],
  [[grant('user:edit', 255)], [grant('system:super_admin', 1)], false],
  [[grant('system:super_admin', 0), grant('user:edit', 3)], [grant('system:super_admin', 0)], true],
])('hierarchy uses actor and target live grants %#', async (actor, target, allowed) => {
  m.db.userPermission.findMany.mockResolvedValueOnce(actor).mockResolvedValueOnce(target);
  expect(await middleware.checkHierarchyPermission(1, 2, 'user:edit')).toBe(allowed);
});

test('same-user hierarchy still needs a grant and superadmin queries contain one key', async () => {
  expect(await middleware.checkHierarchyPermission(1, 1, 'user:edit')).toBe(false);
  m.db.userPermission.findMany.mockResolvedValue([grant('user:edit', 2)]);
  expect(await middleware.checkHierarchyPermission(1, 1, 'user:edit')).toBe(true);
  m.db.userPermission.findMany.mockResolvedValue([grant('system:super_admin', 1)]);
  expect(await middleware.checkHierarchyPermission(1, 2, 'system:super_admin')).toBe(true);
  expect(m.db.userPermission.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: expect.objectContaining({ permission: { key: { in: ['system:super_admin'] } } }) }));
});

test('legacy permission wrappers reject missing session and grants then invoke handler', async () => {
  const handler = vi.fn(async () => NextResponse.json({ ok: true }));
  const run = middleware.withPermission('user:edit')(handler);
  const req = new NextRequest('http://localhost/api/users');
  for (const session of [null, {}, { user: {} }]) {
    m.session.mockResolvedValue(session);
    expect((await run(req)).status).toBe(401);
  }
  m.session.mockResolvedValue({ user: { id: 1 } });
  m.db.userPermission.findFirst.mockResolvedValue(null);
  expect((await run(req)).status).toBe(403);
  expect(handler).not.toHaveBeenCalled();
  m.db.userPermission.findFirst.mockResolvedValue({ id: 2 });
  expect(await (await run(req)).json()).toEqual({ ok: true });
  expect(handler).toHaveBeenCalledWith(req);
  expect((await middleware.withAdminPermission()(handler)(req)).status).toBe(200);
});

test('hierarchy wrapper resolves query/path target and rejects missing or denied targets', async () => {
  const handler = vi.fn(async (_req: NextRequest, target: number) => NextResponse.json({ target }));
  const run = middleware.withHierarchyPermission('user:edit')(handler);
  m.session.mockResolvedValue(null);
  expect((await run(new NextRequest('http://localhost/api'))).status).toBe(401);
  m.session.mockResolvedValue({ user: {} });
  expect((await run(new NextRequest('http://localhost/api'))).status).toBe(401);
  m.session.mockResolvedValue({ user: { id: 1 } });
  expect((await run(new NextRequest('http://localhost/api'))).status).toBe(400);
  expect((await run(new NextRequest('http://localhost/api?targetId=2'))).status).toBe(403);
  m.db.userPermission.findMany.mockImplementation(async ({ where }) => where.userId === 1 ? [grant('user:edit', 10)] : []);
  expect(await (await run(new NextRequest('http://localhost/api?targetId=2'))).json()).toEqual({ target: 2 });
  expect(await (await run(new NextRequest('http://localhost/api/users/3/edit'))).json()).toEqual({ target: 3 });
});

test('session permissions reload current grants and preserves anonymous sessions', async () => {
  for (const session of [null, {}, { user: {} }]) { m.session.mockResolvedValue(session); expect(await middleware.getSessionWithPermissions()).toEqual(session); }
  m.session.mockResolvedValue({ user: { id: 1, permissions: { stale: 255 } }, expires: 'later' });
  m.db.userPermission.findMany.mockResolvedValue([grant('user:edit', 8)]);
  expect(await middleware.getSessionWithPermissions()).toEqual({ user: { id: 1, permissions: { 'user:edit': 8 } }, expires: 'later' });
});

test('permission utilities handle missing catalog and grants and convert all grants to records', async () => {
  m.db.permission.findUnique.mockResolvedValueOnce(null);
  expect(await utils.getUserPermissionValue(1, 'user:edit')).toBe(0);
  expect(await utils.getUserPermissionValue(1, 'user:edit')).toBe(0);
  m.db.userPermission.findUnique.mockResolvedValue({ value: 12 });
  expect(await utils.getUserPermissionValue(1, 'user:edit')).toBe(12);
  m.db.userPermission.findMany.mockResolvedValue([grant('user:edit', 12), grant('orbat:create', 4)]);
  expect(await utils.getUserPermissions(1)).toEqual({ 'user:edit': 12, 'orbat:create': 4 });
  m.db.userPermission.findMany.mockResolvedValue([{ userId: 7 }, { userId: 9 }]);
  expect(await utils.getSuperAdminUserIds()).toEqual([7, 9]);
});

test('utility hierarchy and full-admin thresholds', async () => {
  expect(await utils.canPerformAction(1, 1, 'user:edit')).toBe(true);
  expect(await utils.canPerformAction(1, 2, 'user:edit')).toBe(false);
  m.db.userPermission.findUnique.mockResolvedValueOnce({ value: 10 }).mockResolvedValueOnce({ value: 5 });
  expect(await utils.canPerformAction(1, 2, 'user:edit')).toBe(true);
  m.db.userPermission.findUnique.mockResolvedValue({ value: 5 });
  expect(await utils.canPerformAction(1, 2, 'user:edit')).toBe(false);
  expect(await utils.hasPermission(1, 'user:edit')).toBe(true);
  expect(await utils.isFullAdmin(1)).toBe(false);
  m.db.userPermission.findUnique.mockResolvedValue({ value: 255 });
  expect(await utils.isFullAdmin(1)).toBe(true);
  m.db.userPermission.findUnique.mockResolvedValue(null);
  expect(await utils.hasPermission(1, 'user:edit')).toBe(false);
});

test('setting grants validates range/key/catalog, upserts, revokes and aggregates failures', async () => {
  for (const value of [-1, 256]) await expect(utils.setUserPermission(1, 'user:edit', value)).rejects.toThrow('between 0 and 255');
  await expect(utils.setUserPermission(1, 'missing' as permissions.PermissionKey, 1)).rejects.toThrow('Invalid permission key');
  m.db.permission.findUnique.mockResolvedValueOnce(null);
  await expect(utils.setUserPermission(1, 'user:edit', 1)).rejects.toThrow('not found');
  await utils.setUserPermission(1, 'user:edit', 20);
  expect(m.db.userPermission.upsert).toHaveBeenLastCalledWith({ where: { userId_permissionId: { userId: 1, permissionId: 10 } }, update: { value: 20 }, create: { userId: 1, permissionId: 10, value: 20 } });
  await utils.revokePermission(1, 'user:edit');
  expect(m.db.userPermission.deleteMany).toHaveBeenCalledWith({ where: { userId: 1, permissionId: 10 } });
  await utils.setUserPermissions(1, { 'user:edit': 2 } as Record<permissions.PermissionKey, number>);
  await expect(utils.setUserPermissions(1, { 'user:edit': -1 } as Record<permissions.PermissionKey, number>)).rejects.toThrow('Failed to set some permissions');
  await utils.grantPermission(1, 'user:edit');
  expect(m.db.userPermission.upsert).toHaveBeenLastCalledWith(expect.objectContaining({ update: { value: 50 } }));
  await utils.grantPermission(1, 'user:edit', 7);
  expect(m.db.userPermission.upsert).toHaveBeenLastCalledWith(expect.objectContaining({ update: { value: 7 } }));
  m.db.userPermission.upsert.mockClear(); m.db.userPermission.findUnique.mockResolvedValue({ value: 5 });
  await utils.grantPermission(1, 'user:edit');
  expect(m.db.userPermission.upsert).not.toHaveBeenCalled();
});

test('catalog functions and permission shape validation cover boundary values', () => {
  expect(permissions.getAllPermissionKeys()).toEqual(Object.keys(permissions.PERMISSIONS));
  expect(permissions.getPermissionMetadata('user:edit')).toEqual(permissions.PERMISSIONS['user:edit']);
  expect(permissions.isValidPermissionKey('missing')).toBe(false);
  expect(canModifyUserPermissions(1, 1)).toBe(false); expect(canModifyUserPermissions(1, 2)).toBe(true);
  for (const value of ['1', NaN, Infinity, 1.5, -1, 256]) expect(permissions.isValidPermissionValue(value)).toBe(false);
  for (const value of [0, 1, 255]) expect(permissions.isValidPermissionValue(value)).toBe(true);
  expect(logic.validatePermissionUpdateEntries(null)).toEqual({ valid: false, error: 'Invalid permissions format' });
  for (const entry of [null, 2, {}, { permissionId: '1', value: 2 }, { permissionId: 1, value: '2' }]) expect(logic.validatePermissionUpdateEntries([entry])).toEqual({ valid: false, error: 'Invalid permission data' });
  expect(logic.validatePermissionUpdateEntries([{ permissionId: 1, value: -1 }])).toEqual({ valid: false, error: 'Permission value must be between 0 and 255' });
  expect(logic.validatePermissionUpdateEntries([{ permissionId: 1, value: 255 }])).toEqual({ valid: true });
});

test('each independent catalog read permission grants access, absent permissions deny', () => {
  const templates = { hasSuperAdmin: false, canCreateTemplate: false, canEditTemplate: false, canDeleteTemplate: false, canCreateOrbat: false, canEditOrbat: false };
  expect(logic.canAccessTemplateReadApi(templates)).toBe(false);
  for (const key of Object.keys(templates)) expect(logic.canAccessTemplateReadApi({ ...templates, [key]: true })).toBe(true);
  const subslots = { ...templates, canViewSubslot: false, canCreateSubslot: false, canEditSubslot: false, canDeleteSubslot: false };
  expect(logic.canAccessSubslotReadApi(subslots)).toBe(false);
  for (const key of Object.keys(subslots)) expect(logic.canAccessSubslotReadApi({ ...subslots, [key]: true })).toBe(true);
});

test('bot database authentication rejects missing/invalid/revoked tokens and updates active token use', async () => {
  for (const header of [undefined, 'Basic token', 'Bearer ']) {
    const request = new Request('http://localhost', { headers: header === undefined ? {} : { authorization: header } });
    expect(await bots.authenticateDatabaseBot(request)).toBe(false);
    expect(await validation.validateBotTokenFromRequest(request)).toBe(false);
  }
  expect(await validation.validateBotToken('')).toBe(false);
  m.db.botToken.findFirst.mockResolvedValue(null);
  expect(await bots.authenticateDatabaseBot(new Request('http://localhost', { headers: { authorization: 'Bearer revoked' } }))).toBe(false);
  expect(await validation.validateBotToken('revoked')).toBe(false);
  m.db.botToken.findFirst.mockResolvedValue({ id: 5 });
  expect(await bots.authenticateDatabaseBot(new Request('http://localhost', { headers: { authorization: 'Bearer valid' } }))).toBe(true);
  expect(await validation.validateBotTokenLegacy(new Request('http://localhost', { headers: { authorization: 'Bearer valid' } }))).toBe(true);
  expect(m.db.botToken.update).toHaveBeenCalledWith({ where: { id: 5 }, data: { lastUsedAt: expect.any(Date) } });
  m.db.botToken.findFirst.mockRejectedValue(new Error('offline'));
  expect(await validation.validateBotToken('valid')).toBe(false);
});

test('Discord account lookup, snowflakes and request hashes have stable contracts', async () => {
  m.db.authAccount.findUnique.mockResolvedValue(null); expect(await bots.resolveDiscordUser('123')).toBeNull();
  m.db.authAccount.findUnique.mockResolvedValue({ user: { id: 5 } }); expect(await bots.resolveDiscordUser('123')).toEqual({ id: 5 });
  expect(bots.requestHash({ a: 1 })).toBe('015abd7f5cc57a2dd94b7590f04ad8084273905ee33ec5cebeae62276a97f862');
  expect(bots.isDiscordSnowflake('12345678901234567')).toBe(true);
  expect(bots.isDiscordSnowflake('abc')).toBe(false); expect(bots.isDiscordSnowflake(123)).toBe(false);
});

test('untrimmed bearer header with no token is rejected before database access', async () => {
  const request = { headers: { get: () => 'Bearer   ' } } as unknown as Request;
  expect(await bots.authenticateDatabaseBot(request)).toBe(false);
  expect(m.db.botToken.findFirst).not.toHaveBeenCalled();
});
