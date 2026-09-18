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
