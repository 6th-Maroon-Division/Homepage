import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { NextRequest } from 'next/server';
const mocks = vi.hoisted(() => {
  const model = () => ({ findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), deleteMany: vi.fn() });
  return { session: vi.fn(), encode: vi.fn(), pending: vi.fn(), fetch: vi.fn(), db: { user: model(), authAccount: model(), userPermission: model(), steamLoginAttempt: model(), apiAuditLog: model(), $transaction: vi.fn() } };
});
vi.mock('next-auth', () => ({ getServerSession: mocks.session }));
vi.mock('next-auth/jwt', () => ({ encode: mocks.encode }));
vi.mock('@/app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
vi.mock('@/lib/prisma', () => ({ prisma: mocks.db }));
vi.mock('@/lib/pending-events', () => ({ processPendingEventsForUser: mocks.pending }));
import { GET as login } from '@/app/api/auth/steam-login/route';
import { GET as callback } from '@/app/api/auth/steam-callback/route';
const steamId = '76561198000000001';
let state: string;
let returnTo: string;
async function begin() {
  const response = await login(new NextRequest('https://example.test/api/auth/steam-login'));
  const target = new URL(response.headers.get('location')!);
  returnTo = target.searchParams.get('openid.return_to')!;
  state = new URL(returnTo).searchParams.get('state')!;
  return response;
}
function request(patch: Record<string, string | null> = {}, cookie = state) {
  const url = new URL(returnTo);
  const fields = { 'openid.ns': 'http://specs.openid.net/auth/2.0', 'openid.mode': 'id_res', 'openid.op_endpoint': 'https://steamcommunity.com/openid/login', 'openid.claimed_id': `https://steamcommunity.com/openid/id/${steamId}`, 'openid.identity': `https://steamcommunity.com/openid/id/${steamId}`, 'openid.return_to': returnTo, 'openid.response_nonce': `${new Date().toISOString().slice(0, 19)}Zunique`, 'openid.assoc_handle': 'handle', 'openid.signed': 'op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle', 'openid.sig': 'signed', ...patch };
  for (const [key, value] of Object.entries(fields)) if (value === null) url.searchParams.delete(key); else url.searchParams.set(key, value);
  return new NextRequest(url, { headers: { cookie: `${new URL(returnTo).protocol === 'https:' ? '__Host-steam-state' : 'steam-state'}=${cookie}` } });
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('NEXTAUTH_URL', 'https://example.test'); vi.stubEnv('NEXTAUTH_SECRET', 'test-only-secret'); vi.stubEnv('STEAM_API_KEY', 'test-only-key');
  vi.stubGlobal('fetch', mocks.fetch);
  mocks.session.mockResolvedValue(null);
  mocks.db.steamLoginAttempt.create.mockImplementation(async ({ data }) => { mocks.db.steamLoginAttempt.findUnique.mockResolvedValue(data); return data; });
  mocks.db.steamLoginAttempt.deleteMany.mockResolvedValue({ count: 1 });
  mocks.db.user.findUnique.mockResolvedValue({ id: 4, avatarUrl: null });
  mocks.db.authAccount.findUnique.mockResolvedValue({ id: 3, userId: 10, user: { id: 10, username: 'Steam user', email: null, createdAt: new Date() } });
  mocks.db.userPermission.findMany.mockResolvedValue([]);
  mocks.db.$transaction.mockImplementation(async cb => cb(mocks.db));
  mocks.encode.mockResolvedValue('encoded-session');
  mocks.fetch.mockImplementation(async (url: string | URL) => String(url).startsWith('https://steamcommunity.com/') ? new Response('ns:http://specs.openid.net/auth/2.0\nis_valid:true\n') : Response.json({ response: { players: [{ steamid: steamId, personaname: 'Steam user', avatarfull: 'https://cdn.example/avatar.png' }] } }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
test('login redirects only to pinned Steam with durable hashed browser state and secure cookie', async () => {
  const response = await begin();
  expect(new URL(response.headers.get('location')!).origin).toBe('https://steamcommunity.com');
  expect(state).toMatch(/^[a-f0-9]{64}$/);
  expect(mocks.db.steamLoginAttempt.create).toHaveBeenCalledWith({ data: { stateHash: expect.not.stringMatching(state), userId: null, expiresAt: expect.any(Date) } });
  expect(response.headers.get('set-cookie')).toContain('__Host-steam-state=');
  expect(response.headers.get('set-cookie')).toContain('HttpOnly');
  expect(response.headers.get('set-cookie')).toContain('Secure');
  expect(response.headers.get('set-cookie')).toContain('SameSite=lax');
  expect(response.headers.get('cache-control')).toBe('no-store');
});
test('verified assertion mints session only after Steam verification and atomic attempt consumption/audit', async () => {
  await begin();
  const response = await callback(request());
  expect(response.headers.get('location')).toBe('https://example.test/orbats');
  expect(response.headers.get('set-cookie')).toContain('__Secure-next-auth.session-token=encoded-session');
  expect(mocks.fetch.mock.calls[0][0]).toBe('https://steamcommunity.com/openid/login');
  expect(new URLSearchParams(mocks.fetch.mock.calls[0][1].body).get('openid.mode')).toBe('check_authentication');
  expect(mocks.db.apiAuditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'auth.steam.signed_in', actorUserId: 10, targetUserIds: [10] }) });
  expect(mocks.encode).toHaveBeenCalledWith(expect.objectContaining({ token: expect.objectContaining({ id: 10, provider: 'steam' }) }));
  expect(JSON.stringify(mocks.db.apiAuditLog.create.mock.calls)).not.toContain(steamId);
});
test.each([
  { state: null }, { state: 'attacker' }, { 'openid.claimed_id': 'https://attacker.test/id/76561198000000001' }, { 'openid.identity': 'https://steamcommunity.com/openid/id/76561198000000002' }, { 'openid.op_endpoint': 'https://attacker.test/check' }, { 'openid.return_to': 'https://attacker.test/callback' }, { 'openid.ns': 'bad' }, { 'openid.mode': 'cancel' }, { 'openid.signed': 'claimed_id' }, { 'openid.sig': null }, { 'openid.response_nonce': '2020-01-01T00:00:00Zold' }, { userId: '10' },
] as Record<string, string | null>[])('rejects forged callback fields %j before verification or account mutation', async fields => {
  await begin();
  const response = await callback(request(fields));
  expect(response.headers.get('location')).toContain('error=InvalidSteamResponse');
  expect(mocks.fetch).not.toHaveBeenCalled(); expect(mocks.encode).not.toHaveBeenCalled(); expect(mocks.db.$transaction).not.toHaveBeenCalled();
});
test('missing browser cookie, duplicate parameters, expired and consumed attempts cannot sign in', async () => {
  await begin();
  expect((await callback(request({}, ''))).headers.get('location')).toContain('error=');
  const duplicate = request(); const url = new URL(duplicate.url); url.searchParams.append('state', state);
  expect((await callback(new NextRequest(url, { headers: duplicate.headers }))).headers.get('location')).toContain('error=');
  mocks.db.steamLoginAttempt.findUnique.mockResolvedValue({ stateHash: 'x', userId: null, expiresAt: new Date(0) });
  expect((await callback(request())).headers.get('location')).toContain('error=');
  mocks.db.steamLoginAttempt.findUnique.mockResolvedValue(null);
  expect((await callback(request())).headers.get('location')).toContain('error=');
  expect(mocks.encode).not.toHaveBeenCalled();
});
test('negative Steam verification and mismatched profile identity cannot mint sessions', async () => {
  await begin(); mocks.fetch.mockResolvedValueOnce(new Response('is_valid:false\n'));
  expect((await callback(request())).headers.get('location')).toContain('error=InvalidSteamResponse');
  mocks.fetch.mockResolvedValueOnce(new Response('is_valid:true\n')).mockResolvedValueOnce(Response.json({ response: { players: [{ steamid: '76561198000000002' }] } }));
  expect((await callback(request())).headers.get('location')).toContain('error=SteamAPIError');
  expect(mocks.encode).not.toHaveBeenCalled();
});
test('linking requires identical live initiating session and rejects accounts owned elsewhere', async () => {
  mocks.session.mockResolvedValue({ user: { id: 4 } }); await begin();
  mocks.session.mockResolvedValue({ user: { id: 5 } });
  expect((await callback(request())).headers.get('location')).toContain('error=InvalidSteamResponse');
  expect(mocks.fetch).not.toHaveBeenCalled();
  mocks.session.mockResolvedValue({ user: { id: 4 } });
  expect((await callback(request())).headers.get('location')).toBe('https://example.test/profile?error=SteamAlreadyLinked');
  expect(mocks.encode).not.toHaveBeenCalled();
});
test('failed atomic claim or audit never mints a session', async () => {
  await begin(); mocks.db.steamLoginAttempt.deleteMany.mockResolvedValue({ count: 0 });
  expect((await callback(request())).headers.get('location')).toContain('error=SteamAuthError');
  mocks.db.steamLoginAttempt.deleteMany.mockResolvedValue({ count: 1 }); mocks.db.apiAuditLog.create.mockRejectedValue(new Error('audit'));
  expect((await callback(request())).headers.get('location')).toContain('error=SteamAuthError');
  expect(mocks.encode).not.toHaveBeenCalled();
});
test('pending attendance failure does not invalidate verified committed login', async () => {
  await begin(); mocks.pending.mockRejectedValue(new Error('backfill'));
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  expect((await callback(request())).headers.get('location')).toBe('https://example.test/orbats'); log.mockRestore();
});
test('configuration failures do not use attacker-controlled origin or mint cookies', async () => {
  vi.stubEnv('NEXTAUTH_URL', 'https://name:secret@example.test');
  expect((await login(new NextRequest('https://attacker.test/api/auth/steam-login'))).status).toBe(503);
  vi.stubEnv('NEXTAUTH_URL', 'https://example.test'); vi.stubEnv('NEXTAUTH_SECRET', '');
  expect((await callback(new NextRequest('https://attacker.test/api/auth/steam-callback'))).status).toBe(503);
});
test('Steam documented HTTP claimed identifier is accepted only with identical signed identity and HTTPS verification', async () => {
  await begin();
  const claimed = `http://steamcommunity.com/openid/id/${steamId}`;
  const response = await callback(request({ 'openid.claimed_id': claimed, 'openid.identity': claimed }));
  expect(response.headers.get('location')).toBe('https://example.test/orbats');
  expect(mocks.fetch.mock.calls[0][0]).toBe('https://steamcommunity.com/openid/login');
});
test('denied callback audits metadata only and remains denied when audit storage fails', async () => {
  await begin();
  const first = await callback(request({ userId: '10' }));
  expect(first.headers.get('location')).toContain('error=InvalidSteamResponse');
  expect(mocks.db.apiAuditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ actorType: 'anonymous', action: 'access.denied', resource: 'auth_transport', outcome: 'denied', path: '/api/auth/steam-callback' }) });
  expect(JSON.stringify(mocks.db.apiAuditLog.create.mock.calls)).not.toContain(state);
  mocks.db.apiAuditLog.create.mockRejectedValue(new Error('Audit unavailable'));
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  expect((await callback(request({ userId: '10' }))).headers.get('location')).toContain('error=InvalidSteamResponse');
  expect(mocks.encode).not.toHaveBeenCalled(); log.mockRestore();
});

test('loopback alias redirects before creating state, then localhost login completes with its own cookie', async () => {
  vi.stubEnv('NEXTAUTH_URL', 'http://localhost:3000');
  const alias = new NextRequest('http://127.0.0.1:3000/api/auth/steam-login', { headers: { host: '127.0.0.1:3000' } });
  expect(alias.nextUrl.hostname).toBe('localhost'); // NextURL normalizes the URL, but not Host.
  const canonical = await login(alias);
  expect(canonical.headers.get('location')).toBe('http://localhost:3000/api/auth/steam-login');
  expect(canonical.headers.get('set-cookie')).toBeNull();
  expect(mocks.session).not.toHaveBeenCalled();
  expect(mocks.db.steamLoginAttempt.create).not.toHaveBeenCalled();
  const started = await login(new NextRequest(canonical.headers.get('location')!, { headers: { host: 'localhost:3000' } }));
  returnTo = new URL(started.headers.get('location')!).searchParams.get('openid.return_to')!;
  state = new URL(returnTo).searchParams.get('state')!;
  expect(started.cookies.get('steam-state')?.value).toBe(state);
  const completed = await callback(request());
  expect(completed.headers.get('location')).toBe('http://localhost:3000/orbats');
  expect(completed.cookies.get('next-auth.session-token')?.value).toBe('encoded-session');
});
test('canonical proxy host avoids a redirect loop and unrelated hosts redirect only to configured origin', async () => {
  const proxied = await login(new NextRequest('http://internal:3000/api/auth/steam-login', { headers: { host: 'internal:3000', 'x-forwarded-host': 'example.test' } }));
  expect(new URL(proxied.headers.get('location')!).origin).toBe('https://steamcommunity.com');
  const unrelated = await login(new NextRequest('https://untrusted.test/api/auth/steam-login', { headers: { host: 'untrusted.test' } }));
  expect(unrelated.headers.get('location')).toBe('https://example.test/api/auth/steam-login');
  expect(unrelated.headers.get('set-cookie')).toBeNull();
});
test('login rejects query parameters and invalid or deleted session users before storing state', async () => {
 expect((await login(new NextRequest('https://example.test/api/auth/steam-login?next=evil'))).headers.get('location')).toContain('InvalidSteamRequest');
 for (const id of ['invalid', 2147483648, 4]) {
  mocks.session.mockResolvedValue({ user: { id } }); mocks.db.user.findUnique.mockResolvedValue(null);
  expect((await login(new NextRequest('https://example.test/api/auth/steam-login'))).status).toBe(503);
 }
 expect(mocks.db.steamLoginAttempt.create).not.toHaveBeenCalled();
});
test('default development origin is localhost and production requires HTTPS', async () => {
 vi.stubEnv('NEXTAUTH_URL', '');
 expect((await login(new NextRequest('http://localhost:3000/api/auth/steam-login'))).headers.get('location')).toContain('https://steamcommunity.com/');
 vi.stubEnv('NODE_ENV', 'production');
 expect((await login(new NextRequest('http://localhost:3000/api/auth/steam-login'))).status).toBe(503);
});
test.each([
 { 'openid.claimed_id': null }, { 'openid.signed': null }, { 'openid.assoc_handle': null }, { 'openid.response_nonce': null },
 { 'openid.response_nonce': 'not-a-date' }, { 'openid.response_nonce': '2026-13-18T00:00:00Znonce' },
 { 'openid.response_nonce': '2026-02-30T00:00:00Znonce' }, { 'openid.response_nonce': '2099-01-01T00:00:00Znonce' },
] as Record<string, string | null>[])('Steam rejects missing signed fields or invalid nonces %j', async patch => {
 await begin(); expect((await callback(request(patch))).headers.get('location')).toContain('InvalidSteamResponse'); expect(mocks.fetch).not.toHaveBeenCalled();
});
test('Steam callback without a state cookie fails before reading the attempt', async () => {
 await begin();
 const original = request();
 expect((await callback(new NextRequest(original.url))).headers.get('location')).toContain('InvalidSteamResponse');
 expect(mocks.db.steamLoginAttempt.findUnique).not.toHaveBeenCalled();
});
test('Steam profile retrieval requires configured API access and successful response', async () => {
 await begin(); vi.stubEnv('STEAM_API_KEY', '');
 expect((await callback(request())).headers.get('location')).toContain('SteamAuthError');
 vi.stubEnv('STEAM_API_KEY', 'test');
 mocks.fetch.mockResolvedValueOnce(new Response('is_valid:true')).mockResolvedValueOnce(new Response('', { status: 503 }));
 expect((await callback(request())).headers.get('location')).toContain('SteamAPIError');
});
test('new Steam accounts use safe profile fallbacks and verified granted permissions', async () => {
 await begin();
 mocks.fetch.mockResolvedValueOnce(new Response('is_valid:true')).mockResolvedValueOnce(Response.json({ response: { players: [{ steamid: steamId, personaname: '', avatarfull: 'http://unsafe/avatar' }] } }));
 mocks.db.authAccount.findUnique.mockResolvedValue(null);
 mocks.db.user.create.mockResolvedValue({ id: 10 });
 mocks.db.authAccount.findUniqueOrThrow.mockResolvedValue({ id: 3, userId: 10, user: { id: 10, username: 'Steam User' } });
 mocks.db.userPermission.findMany.mockResolvedValue([{ permission: { key: 'user:edit' }, value: 5 }]);
 expect((await callback(request())).headers.get('location')).toContain('/orbats');
 expect(mocks.db.user.create).toHaveBeenCalledWith({ data: expect.objectContaining({ username: 'Steam User', avatarUrl: null }) });
 expect(mocks.encode).toHaveBeenCalledWith(expect.objectContaining({ token: expect.objectContaining({ permissions: { 'user:edit': 5 } }) }));
});
test('Steam account linking fills missing avatars and aborts when user disappears', async () => {
 mocks.session.mockResolvedValue({ user: { id: 4 } }); await begin();
 mocks.db.authAccount.findUnique.mockResolvedValue(null);
 mocks.db.authAccount.create.mockResolvedValue({ id: 3, userId: 4, user: { id: 4 } });
 expect((await callback(request())).headers.get('location')).toContain('success=SteamLinked');
 expect(mocks.db.user.update).toHaveBeenCalledWith({ where: { id: 4 }, data: { avatarUrl: 'https://cdn.example/avatar.png' } });
 mocks.db.authAccount.findUnique.mockResolvedValue({ id: 3, userId: 4, user: { id: 4 } });
 mocks.db.user.findUnique.mockResolvedValueOnce({ id: 4 }).mockResolvedValueOnce(null);
 expect((await callback(request())).headers.get('location')).toContain('SteamAuthError');
});
test('already linked Steam account preserves its avatar and requires no new account', async () => {
 mocks.session.mockResolvedValue({ user: { id: 4 } });
 mocks.db.user.findUnique.mockResolvedValue({ id: 4, avatarUrl: 'https://existing/avatar' });
 mocks.db.authAccount.findUnique.mockResolvedValue({ id: 3, userId: 4, user: { id: 4 } });
 await begin();
 expect((await callback(request())).headers.get('location')).toContain('success=SteamLinked');
 expect(mocks.db.authAccount.create).not.toHaveBeenCalled(); expect(mocks.db.user.update).not.toHaveBeenCalled();
});
