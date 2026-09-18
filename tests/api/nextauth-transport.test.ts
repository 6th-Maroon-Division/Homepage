import { beforeEach, expect, test, vi } from 'vitest';
const mocks = vi.hoisted(() => {
  const model = () => ({ findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn() });
  return { cookie: { get: vi.fn(), getAll: vi.fn(), set: vi.fn() }, decode: vi.fn(), pending: vi.fn(), db: { user: model(), authAccount: model(), userPermission: model(), apiAuditLog: model(), $transaction: vi.fn() } };
});
vi.mock('next-auth', () => ({ default: () => () => new Response('NextAuth protocol') }));
vi.mock('next-auth/jwt', () => ({ decode: mocks.decode }));
vi.mock('next/headers', () => ({ cookies: async () => mocks.cookie }));
vi.mock('@/lib/prisma', () => ({ prisma: mocks.db }));
vi.mock('@/lib/pending-events', () => ({ processPendingEventsForUser: mocks.pending }));
import { authOptions, GET, POST } from '@/app/api/auth/[...nextauth]/route';
const signin = (profile: unknown = { id: '123456789012345678', username: 'Discord user' }, provider = 'discord') => authOptions.callbacks!.signIn!({ account: { provider }, profile } as never);
const jwt = (args: unknown) => authOptions.callbacks!.jwt!(args as never);
const owner = { id: 10, username: 'Owner', email: null, createdAt: new Date() };
beforeEach(() => {
  vi.resetAllMocks(); mocks.cookie.getAll.mockReturnValue([]);
  mocks.db.authAccount.findUnique.mockResolvedValue({ id: 1, userId: 10, user: owner });
  mocks.db.user.findUnique.mockResolvedValue(owner);
  mocks.db.userPermission.findMany.mockResolvedValue([{ value: 1, permission: { key: 'user:edit' } }]);
  mocks.db.$transaction.mockImplementation(async cb => cb(mocks.db));
});
test('NextAuth GET and POST retain native protocol transport', async () => { expect(await (await GET()).text()).toBe('NextAuth protocol'); expect(await (await POST()).text()).toBe('NextAuth protocol'); });
test.each([null, {}, { id: '../forged' }, { id: 123 }])('rejects malformed provider identity %j before database access', async profile => {
  expect(await signin(profile)).toBe(false); expect(mocks.db.$transaction).not.toHaveBeenCalled();
});
test('rejects unsupported provider and audits verified Discord signin without personal snapshots', async () => {
  expect(await signin({ id: '123456789012345678' }, 'steam')).toBe(false);
  expect(await signin()).toBe(true);
  expect(mocks.db.apiAuditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'auth.discord.signed_in', actorUserId: 10, targetUserIds: [10] }) });
  expect(JSON.stringify(mocks.db.apiAuditLog.create.mock.calls)).not.toContain('123456789012345678');
});
test('Discord JWT resolves only Discord namespace despite matching Steam subject', async () => {
  const result = await jwt({ token: { sub: '123456789012345678' }, trigger: 'signIn', account: { provider: 'discord' } });
  expect(result).toMatchObject({ id: 10, provider: 'discord', permissions: { 'user:edit': 1 } });
  expect(mocks.db.authAccount.findUnique).toHaveBeenCalledTimes(1);
  expect(mocks.db.authAccount.findUnique).toHaveBeenCalledWith({ where: { provider_providerUserId: { provider: 'discord', providerUserId: '123456789012345678' } }, include: { user: true } });
});
test('signed token refresh resolves its internal user ID without cross-provider subject lookup', async () => {
  const result = await jwt({ token: { id: 10, sub: 'same-subject', provider: 'steam' }, trigger: 'update' });
  expect(result.id).toBe(10); expect(mocks.db.authAccount.findUnique).not.toHaveBeenCalled();
  expect(mocks.db.user.findUnique).toHaveBeenCalledWith({ where: { id: 10 } });
  mocks.db.user.findUnique.mockResolvedValue(null);
  expect(await jwt({ token: { id: 10, permissions: { 'system:super_admin': 255 } }, trigger: 'update' })).toEqual({ permissions: {} });
});
test('unbound or unsupported signin subjects cannot acquire another provider identity', async () => {
  expect(await jwt({ token: { sub: '123456789012345678' }, trigger: 'signIn', account: { provider: 'steam' } })).toEqual({ sub: '123456789012345678', permissions: {} });
  expect(mocks.db.authAccount.findUnique).not.toHaveBeenCalled();
});
test('audit storage failure aborts signin transaction', async () => {
  mocks.db.apiAuditLog.create.mockRejectedValue(new Error('Audit unavailable'));
  await expect(signin()).rejects.toThrow('Audit unavailable');
  expect(mocks.pending).not.toHaveBeenCalled();
});
test('Discord creates first-time accounts with profile fallbacks and sanitizes avatar scheme', async () => {
  mocks.db.authAccount.findUnique.mockResolvedValue(null);
  mocks.db.authAccount.findUniqueOrThrow.mockResolvedValue({ id: 1, userId: 10, user: owner });
  for (const [profile, expected] of [
    [{ id: '123456789012345678', global_name: 'Display', email: 'person@example.test', image_url: 'https://cdn.example/a.png' }, { username: 'Display', email: 'person@example.test', avatarUrl: 'https://cdn.example/a.png' }],
    [{ id: '123456789012345678', username: '', global_name: '', image_url: 'http://unsafe.example/a.png' }, { username: 'Unknown', email: null, avatarUrl: null }],
  ] as const) {
    expect(await signin(profile)).toBe(true);
    expect(mocks.db.user.create).toHaveBeenLastCalledWith({ data: expect.objectContaining(expected) });
  }
});
test('Discord chunked secure session token links only to the current existing user and refreshes avatar', async () => {
  vi.stubEnv('NEXTAUTH_URL', 'https://example.test'); vi.stubEnv('NEXTAUTH_SECRET', 'test-secret');
  try {
    mocks.cookie.getAll.mockReturnValue([{ name: '__Secure-next-auth.session-token.1', value: 'second' }, { name: '__Secure-next-auth.session-token.0', value: 'first' }, { name: 'unrelated', value: 'other' }]);
    mocks.cookie.get.mockImplementation(name => name === 'discord-avatar-refresh' ? { value: '1' } : undefined);
    mocks.decode.mockResolvedValue({ id: 10 });
    mocks.db.authAccount.findUnique.mockResolvedValue(null);
    mocks.db.authAccount.create.mockResolvedValue({ id: 1, userId: 10, user: owner });
    mocks.pending.mockRejectedValue(new Error('backfill offline'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(await signin({ id: '123456789012345678', username: 'Updated', image_url: 'https://cdn.example/avatar.png' })).toBe(true);
      expect(mocks.decode).toHaveBeenCalledWith({ token: 'firstsecond', secret: 'test-secret' });
      expect(mocks.db.authAccount.create).toHaveBeenCalledWith(expect.objectContaining({ data: { provider: 'discord', providerUserId: '123456789012345678', userId: 10 } }));
      expect(mocks.db.user.update).toHaveBeenCalledWith({ where: { id: 10 }, data: { avatarUrl: 'https://cdn.example/avatar.png' } });
      expect(mocks.cookie.set).toHaveBeenCalledWith('discord-avatar-refresh', '', { maxAge: 0, path: '/' });
      expect(error).toHaveBeenCalledWith('Discord attendance backfill failed');
    } finally { error.mockRestore(); }
  } finally { vi.unstubAllEnvs(); }
});
test('Discord rejects stale, stolen, oversized and invalid existing sessions', async () => {
  vi.stubEnv('NEXTAUTH_SECRET', 'test-secret');
  try {
    mocks.cookie.get.mockReturnValue({ value: 'session' });
    mocks.decode.mockResolvedValue({ id: 2147483648 });
    expect(await signin()).toBe(false);
    mocks.decode.mockRejectedValue(new Error('invalid signature'));
    expect(await signin()).toBe(false);
    mocks.decode.mockResolvedValue({ id: 10 });
    mocks.db.user.findUnique.mockResolvedValue(null);
    expect(await signin()).toBe(false);
    mocks.db.user.findUnique.mockResolvedValue(owner);
    mocks.db.authAccount.findUnique.mockResolvedValue({ id: 1, userId: 11, user: { ...owner, id: 11 } });
    expect(await signin()).toBe(false);
    mocks.db.authAccount.findUnique.mockResolvedValue({ id: 1, userId: 10, user: owner });
    expect(await signin()).toBe(true);
  } finally { vi.unstubAllEnvs(); }
});
test('Discord denial stays denied even when its audit cannot be stored', async () => {
  mocks.db.apiAuditLog.create.mockRejectedValue(new Error('storage unavailable'));
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  try { expect(await signin(null)).toBe(false); expect(error).toHaveBeenCalledWith('Authentication denial audit unavailable'); }
  finally { error.mockRestore(); }
});
test('JWT does not reload stable internal identity and session projects nullable defaults', async () => {
  expect(await jwt({ token: { id: 10, permissions: { 'user:edit': 4 } } })).toEqual({ id: 10, permissions: { 'user:edit': 4 } });
  expect(mocks.db.user.findUnique).not.toHaveBeenCalled();
  expect(await jwt({ token: {} })).toEqual({ permissions: {} });
  expect(await jwt({ token: { id: 2147483648 }, trigger: 'update' })).toEqual({ permissions: {} });
  expect(await jwt({ token: {}, trigger: 'signIn', account: { provider: 'discord' } })).toEqual({ provider: 'discord', permissions: {} });
  const session = authOptions.callbacks!.session!;
  expect(await session({ session: {}, token: {} } as never)).toEqual({});
  expect(await session({ session: { user: {} }, token: {} } as never)).toEqual({ user: { id: undefined, username: null, email: null, createdAt: undefined, permissions: {} } });
  expect(await session({ session: { user: {} }, token: { id: 10, username: 'User', email: 'user@example.test', createdAt: owner.createdAt, permissions: { 'user:edit': 4 } } } as never)).toEqual({ user: { id: 10, username: 'User', email: 'user@example.test', createdAt: owner.createdAt, permissions: { 'user:edit': 4 } } });
});
test('linking Discord preserves an existing avatar when provider has no secure avatar', async () => {
 vi.stubEnv('NEXTAUTH_SECRET', 'test-secret');
 try {
  mocks.cookie.get.mockReturnValue({ value: 'session' }); mocks.decode.mockResolvedValue({ id: 10 });
  mocks.db.user.findUnique.mockResolvedValue({ ...owner, avatarUrl: 'https://existing/avatar' });
  mocks.db.authAccount.findUnique.mockResolvedValue(null); mocks.db.authAccount.create.mockResolvedValue({ id: 1, userId: 10, user: owner });
  expect(await signin()).toBe(true); expect(mocks.db.user.update).not.toHaveBeenCalled();
 } finally { vi.unstubAllEnvs(); }
});
