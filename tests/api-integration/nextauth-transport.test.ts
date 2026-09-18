import { afterAll, afterEach, beforeEach, expect, test, vi } from 'vitest';
import { encode } from 'next-auth/jwt';
import type { Prisma } from '@/generated/prisma/client';
const mocks = vi.hoisted(() => ({ cookie: new Map<string, string>(), set: vi.fn(), pending: vi.fn() }));
vi.mock('next-auth', () => ({ default: () => () => new Response('NextAuth protocol') }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: (key: string) => mocks.cookie.has(key) ? { value: mocks.cookie.get(key) } : undefined, getAll: () => [...mocks.cookie].map(([name, value]) => ({ name, value })), set: mocks.set }) }));
vi.mock('@/lib/pending-events', () => ({ processPendingEventsForUser: mocks.pending }));
import { prisma } from '@/lib/prisma';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
const secret = 'isolated-nextauth-integration-secret';
const signin = (id: string) => authOptions.callbacks!.signIn!({ account: { provider: 'discord' }, profile: { id, username: 'Discord integration' } } as never);
const jwt = (args: unknown) => authOptions.callbacks!.jwt!(args as never);
beforeEach(() => { mocks.cookie.clear(); vi.stubEnv('NEXTAUTH_SECRET', secret); vi.stubEnv('NEXTAUTH_URL', 'https://example.test'); });
afterEach(() => { vi.unstubAllEnvs(); });
afterAll(async () => { await prisma.$disconnect(); });
test('Discord subjects never select a different Steam owner with the same provider identifier', async () => {
  const subject = '76561400000000001';
  const steam = await prisma.user.create({ data: { username: 'Different Steam owner', accounts: { create: { provider: 'steam', providerUserId: subject } } } });
  const discord = await prisma.user.create({ data: { username: 'Actual Discord owner', accounts: { create: { provider: 'discord', providerUserId: subject } } } });
  expect(await signin(subject)).toBe(true);
  const token = await jwt({ token: { sub: subject }, trigger: 'signIn', account: { provider: 'discord' } });
  expect(token.id).toBe(discord.id); expect(token.id).not.toBe(steam.id);
  expect(await prisma.apiAuditLog.findFirst({ where: { action: 'auth.discord.signed_in', actorUserId: discord.id } })).not.toBeNull();
  const refreshed = await jwt({ token: { id: steam.id, sub: subject, provider: 'steam' }, trigger: 'update' });
  expect(refreshed.id).toBe(steam.id);
});
test('live account linking rejects another owner and links a new verified account to the initiating signed user', async () => {
  const actor = await prisma.user.create({ data: { username: 'Discord linking actor' } });
  const other = await prisma.user.create({ data: { username: 'Discord linking other', accounts: { create: { provider: 'discord', providerUserId: '76561400000000002' } } } });
  const token = await encode({ token: { id: actor.id }, secret });
  mocks.cookie.set('__Secure-next-auth.session-token', token);
  expect(await signin('76561400000000002')).toBe(false);
  expect((await prisma.authAccount.findUniqueOrThrow({ where: { provider_providerUserId: { provider: 'discord', providerUserId: '76561400000000002' } } })).userId).toBe(other.id);
  expect(await signin('76561400000000003')).toBe(true);
  expect((await prisma.authAccount.findUniqueOrThrow({ where: { provider_providerUserId: { provider: 'discord', providerUserId: '76561400000000003' } } })).userId).toBe(actor.id);
  expect(await prisma.apiAuditLog.findFirst({ where: { action: 'auth.discord.linked', actorUserId: actor.id } })).not.toBeNull();
});
test('failed audit rolls back new Discord account and user atomically', async () => {
  const count = await prisma.user.count();
  const transaction = prisma.$transaction.bind(prisma);
  const spy = vi.spyOn(prisma, '$transaction').mockImplementation(((operation: (tx: Prisma.TransactionClient) => Promise<unknown>) => transaction(async tx => {
    const fail = vi.spyOn(tx.apiAuditLog, 'create').mockRejectedValue(new Error('Audit unavailable'));
    try { return await operation(tx); } finally { fail.mockRestore(); }
  })) as typeof prisma.$transaction);
  try { await expect(signin('76561400000000004')).rejects.toThrow('Audit unavailable'); } finally { spy.mockRestore(); }
  expect(await prisma.user.count()).toBe(count);
  expect(await prisma.authAccount.count({ where: { provider: 'discord', providerUserId: '76561400000000004' } })).toBe(0);
});
