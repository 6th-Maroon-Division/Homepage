import { afterAll, afterEach, beforeEach, expect, test, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { decode } from 'next-auth/jwt';
import type { Prisma } from '@/generated/prisma/client';
const mocks = vi.hoisted(() => ({ userId: null as number | null, fetch: vi.fn(), pending: vi.fn() }));
vi.mock('next-auth', () => ({ getServerSession: async () => mocks.userId === null ? null : { user: { id: mocks.userId } } }));
vi.mock('@/app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
vi.mock('@/lib/pending-events', () => ({ processPendingEventsForUser: mocks.pending }));
import { prisma } from '@/lib/prisma';
import { GET as login } from '@/app/api/auth/steam-login/route';
import { GET as callback } from '@/app/api/auth/steam-callback/route';
let index = 0;
let steamId: string;
let state: string;
let returnTo: string;
const secret = 'isolated-steam-integration-auth-secret';
async function begin() {
  const response = await login(new NextRequest('https://example.test/api/auth/steam-login'));
  expect(response.status).toBe(307);
  returnTo = new URL(response.headers.get('location')!).searchParams.get('openid.return_to')!;
  state = new URL(returnTo).searchParams.get('state')!;
  return response;
}
function req(patch: Record<string, string> = {}, browserState = state) {
  const url = new URL(returnTo);
  for (const [key, value] of Object.entries({ 'openid.ns': 'http://specs.openid.net/auth/2.0', 'openid.mode': 'id_res', 'openid.op_endpoint': 'https://steamcommunity.com/openid/login', 'openid.claimed_id': `https://steamcommunity.com/openid/id/${steamId}`, 'openid.identity': `https://steamcommunity.com/openid/id/${steamId}`, 'openid.return_to': returnTo, 'openid.response_nonce': `${new Date().toISOString().slice(0, 19)}Ztest${index}`, 'openid.assoc_handle': 'handle', 'openid.signed': 'op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle', 'openid.sig': 'test-signature', ...patch })) url.searchParams.set(key, value);
  return new NextRequest(url, { headers: { cookie: `__Host-steam-state=${browserState}` } });
}
beforeEach(() => {
  mocks.userId = null; mocks.pending.mockReset(); mocks.fetch.mockReset();
  steamId = String(BigInt('76561300000000000') + BigInt(++index));
  vi.stubEnv('NEXTAUTH_URL', 'https://example.test'); vi.stubEnv('NEXTAUTH_SECRET', secret); vi.stubEnv('STEAM_API_KEY', 'mock-api-key'); vi.stubGlobal('fetch', mocks.fetch);
  mocks.fetch.mockImplementation(async (url: string | URL) => String(url).startsWith('https://steamcommunity.com/') ? new Response('is_valid:true\n') : Response.json({ response: { players: [{ steamid: steamId, personaname: `Steam integration ${index}`, avatarfull: 'https://cdn.example/avatar.png' }] } }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
afterAll(async () => { await prisma.$disconnect(); });
test('verified login creates account and session with atomic audit; consumed state cannot replay', async () => {
  await begin();
  expect(await prisma.steamLoginAttempt.findUnique({ where: { stateHash: state } })).toBeNull();
  const response = await callback(req());
  expect(response.headers.get('location')).toBe('https://example.test/orbats');
  const cookie = response.cookies.get('__Secure-next-auth.session-token');
  expect(cookie).toBeDefined();
  const decoded = await decode({ token: cookie!.value, secret });
  const account = await prisma.authAccount.findUniqueOrThrow({ where: { provider_providerUserId: { provider: 'steam', providerUserId: steamId } } });
  expect(decoded).toMatchObject({ id: account.userId, sub: steamId, provider: 'steam' });
  const audit = await prisma.apiAuditLog.findFirstOrThrow({ where: { action: 'auth.steam.signed_in', resourceId: String(account.id) } });
  expect(audit).toMatchObject({ actorUserId: account.userId, targetUserIds: [account.userId], before: null, after: null });
  expect(JSON.stringify(audit)).not.toContain(steamId);
  const calls = mocks.fetch.mock.calls.length;
  const replay = await callback(req());
  expect(replay.headers.get('location')).toContain('error=InvalidSteamResponse');
  expect(replay.cookies.get('__Secure-next-auth.session-token')).toBeUndefined();
  expect(mocks.fetch).toHaveBeenCalledTimes(calls);
});
test('forged provider assertion, mismatched browser state and unverified userId cannot create accounts', async () => {
  await begin();
  for (const request of [req({}, 'different'), req({ userId: '1' }), req({ 'openid.return_to': 'https://attacker.test/' }), req({ 'openid.response_nonce': '2020-01-01T00:00:00Zold' })]) {
    const response = await callback(request); expect(response.headers.get('location')).toContain('error='); expect(response.cookies.get('__Secure-next-auth.session-token')).toBeUndefined();
  }
  expect(mocks.fetch).not.toHaveBeenCalled();
  mocks.fetch.mockResolvedValueOnce(new Response('is_valid:false\n'));
  expect((await callback(req())).headers.get('location')).toContain('error=InvalidSteamResponse');
  expect(await prisma.authAccount.count({ where: { provider: 'steam', providerUserId: steamId } })).toBe(0);
});
test('account linking is bound to the original live session and cannot transfer another user Steam identity', async () => {
  const actor = await prisma.user.create({ data: { username: 'Steam linking actor' } });
  const other = await prisma.user.create({ data: { username: 'Steam linking other' } });
  mocks.userId = actor.id; await begin(); mocks.userId = other.id;
  expect((await callback(req())).headers.get('location')).toContain('error=InvalidSteamResponse');
  expect(mocks.fetch).not.toHaveBeenCalled();
  mocks.userId = actor.id;
  const linked = await callback(req());
  expect(linked.headers.get('location')).toBe('https://example.test/profile?success=SteamLinked');
  expect(linked.cookies.get('__Secure-next-auth.session-token')).toBeUndefined();
  expect((await prisma.authAccount.findUniqueOrThrow({ where: { provider_providerUserId: { provider: 'steam', providerUserId: steamId } } })).userId).toBe(actor.id);
  mocks.userId = other.id; await begin();
  expect((await callback(req())).headers.get('location')).toBe('https://example.test/profile?error=SteamAlreadyLinked');
  expect((await prisma.authAccount.findUniqueOrThrow({ where: { provider_providerUserId: { provider: 'steam', providerUserId: steamId } } })).userId).toBe(actor.id);
});
test('audit failure rolls back attempt consumption and newly created user/account and issues no cookie', async () => {
  await begin();
  const before = await prisma.user.count();
  const transaction = prisma.$transaction.bind(prisma);
  const spy = vi.spyOn(prisma, '$transaction').mockImplementation(((operation: (tx: Prisma.TransactionClient) => Promise<unknown>, options?: { isolationLevel?: Prisma.TransactionIsolationLevel }) => transaction(async tx => {
    const fail = vi.spyOn(tx.apiAuditLog, 'create').mockRejectedValue(new Error('Audit unavailable'));
    try { return await operation(tx); } finally { fail.mockRestore(); }
  }, options)) as typeof prisma.$transaction);
  let response;
  try { response = await callback(req()); } finally { spy.mockRestore(); }
  expect(response.headers.get('location')).toContain('error=SteamAuthError');
  expect(response.cookies.get('__Secure-next-auth.session-token')).toBeUndefined();
  expect(await prisma.user.count()).toBe(before);
  expect(await prisma.authAccount.count({ where: { provider: 'steam', providerUserId: steamId } })).toBe(0);
  expect((await callback(req())).headers.get('location')).toBe('https://example.test/orbats');
});
