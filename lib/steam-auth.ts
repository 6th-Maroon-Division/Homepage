import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { encode } from 'next-auth/jwt';
import { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { processPendingEventsForUser } from '@/lib/pending-events';
import { writeApiAudit } from '@/lib/api/audit';
import { parsePositiveId } from '@/lib/api/validation';

const endpoint = 'https://steamcommunity.com/openid/login';
const namespace = 'http://specs.openid.net/auth/2.0';
const age = 600;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
function configuration() {
  if (!process.env.NEXTAUTH_SECRET) throw new Error('Authentication secret missing');
  const base = new URL(process.env.NEXTAUTH_URL || 'http://localhost:3000');
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash || base.pathname !== '/' || process.env.NODE_ENV === 'production' && base.protocol !== 'https:') throw new Error('Invalid authentication origin');
  const secure = base.protocol === 'https:';
  return { base: base.origin, secure, cookie: secure ? '__Host-steam-state' : 'steam-state', secret: process.env.NEXTAUTH_SECRET };
}
async function sessionId() {
  const value = (await getServerSession(authOptions))?.user?.id;
  if (value === undefined) return null;
  const id = parsePositiveId(value);
  if (id === null || id > 2147483647 || !await prisma.user.findUnique({ where: { id }, select: { id: true } })) throw new Error('Invalid session');
  return id;
}
function redirect(base: string, path: string) {
  const response = NextResponse.redirect(new URL(path, base));
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('Referrer-Policy', 'no-referrer');
  return response;
}
function finish(base: string, cookie: string, secure: boolean, path: string) {
  const response = redirect(base, path);
  response.cookies.set(cookie, '', { httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: 0 });
  return response;
}
async function denySteam(config: ReturnType<typeof configuration>, error: string, path = '/', requestPath = '/api/auth/steam-callback') {
  try { await writeApiAudit(prisma, { principal: null, correlationId: randomUUID(), method: 'GET', path: requestPath }, { action: 'access.denied', resource: 'auth_transport', outcome: 'denied' }); }
  catch { console.error('Authentication denial audit unavailable'); }
  return finish(config.base, config.cookie, config.secure, `${path}?error=${error}`);
}
export async function beginSteamLogin(request: NextRequest) {
  try {
    const config = configuration();
    if (request.nextUrl.searchParams.size) return denySteam(config, 'InvalidSteamRequest', '/', '/api/auth/steam-login');
    // NextURL normalizes loopback aliases to localhost. Compare the original
    // browser host so the state cookie is set on the callback's actual host.
    // Only redirect to the configured origin, never to a header-supplied URL.
    const browserHost = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? request.nextUrl.host;
    if (browserHost.toLowerCase() !== new URL(config.base).host.toLowerCase()) {
      return redirect(config.base, '/api/auth/steam-login');
    }
    const userId = await sessionId();
    const state = randomBytes(32).toString('hex');
    await prisma.steamLoginAttempt.deleteMany({ where: { expiresAt: { lte: new Date() } } });
    await prisma.steamLoginAttempt.create({ data: { stateHash: hash(state), userId, expiresAt: new Date(Date.now() + age * 1000) } });
    const returnTo = new URL('/api/auth/steam-callback', config.base); returnTo.searchParams.set('state', state);
    const params = new URLSearchParams({ 'openid.ns': namespace, 'openid.mode': 'checkid_setup', 'openid.return_to': returnTo.toString(), 'openid.realm': config.base, 'openid.identity': `${namespace}/identifier_select`, 'openid.claimed_id': `${namespace}/identifier_select` });
    const response = redirect(config.base, `${endpoint}?${params}`);
    response.cookies.set(config.cookie, state, { httpOnly: true, secure: config.secure, sameSite: 'lax', path: '/', maxAge: age });
    return response;
  } catch { return new NextResponse('Authentication is temporarily unavailable.', { status: 503, headers: { 'Cache-Control': 'no-store' } }); }
}

export async function completeSteamLogin(request: NextRequest) {
  let config: ReturnType<typeof configuration>;
  try { config = configuration(); } catch { return new NextResponse('Authentication is temporarily unavailable.', { status: 503 }); }
  const denied = (error = 'InvalidSteamResponse') => denySteam(config, error);
  try {
    const params = request.nextUrl.searchParams;
    const allowed = ['state', 'openid.ns', 'openid.mode', 'openid.op_endpoint', 'openid.claimed_id', 'openid.identity', 'openid.return_to', 'openid.response_nonce', 'openid.assoc_handle', 'openid.signed', 'openid.sig'];
    for (const key of params.keys()) if (!allowed.includes(key) || params.getAll(key).length !== 1 || params.get(key)!.length > 4096) return denied();
    const state = params.get('state') ?? '';
    const cookie = request.cookies.get(config.cookie)?.value ?? '';
    if (!/^[a-f0-9]{64}$/.test(state) || !/^[a-f0-9]{64}$/.test(cookie) || !timingSafeEqual(Buffer.from(state), Buffer.from(cookie))) return denied();
    const attempt = await prisma.steamLoginAttempt.findUnique({ where: { stateHash: hash(state) } });
    if (!attempt || attempt.expiresAt <= new Date()) return denied();
    const userId = await sessionId();
    if (attempt.userId !== userId) return denied();
    const returnTo = new URL('/api/auth/steam-callback', config.base); returnTo.searchParams.set('state', state);
    const claimed = params.get('openid.claimed_id') ?? '';
    const match = /^https?:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/.exec(claimed);
    if (!match || params.get('openid.identity') !== claimed || params.get('openid.mode') !== 'id_res' || params.get('openid.ns') !== namespace || params.get('openid.op_endpoint') !== endpoint || params.get('openid.return_to') !== returnTo.toString()) return denied();
    const signed = params.get('openid.signed')?.split(',') ?? [];
    if (!['op_endpoint', 'claimed_id', 'identity', 'return_to', 'response_nonce', 'assoc_handle'].every(field => signed.includes(field)) || !params.get('openid.sig') || !params.get('openid.assoc_handle')) return denied();
    const nonce = params.get('openid.response_nonce') ?? '';
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z[!-~]{1,235}$/.test(nonce)) return denied();
    const timestamp = new Date(nonce.slice(0, 20));
    if (!Number.isFinite(timestamp.getTime()) || timestamp.toISOString().slice(0, 19) + 'Z' !== nonce.slice(0, 20) || Date.now() - timestamp.getTime() > age * 1000 || timestamp.getTime() - Date.now() > 60000) return denied();
    const verification = new URLSearchParams(params); verification.delete('state'); verification.set('openid.mode', 'check_authentication');
    const checked = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: verification.toString(), redirect: 'error', signal: AbortSignal.timeout(10000), cache: 'no-store' });
    if (!checked.ok || !(await checked.text()).split(/\r?\n/).includes('is_valid:true')) return denied();
    const steamId = match[1];
    if (!process.env.STEAM_API_KEY) throw new Error('Steam configuration missing');
    const profileUrl = new URL('https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/');
    profileUrl.searchParams.set('key', process.env.STEAM_API_KEY); profileUrl.searchParams.set('steamids', steamId);
    const profileResponse = await fetch(profileUrl, { redirect: 'error', signal: AbortSignal.timeout(10000), cache: 'no-store' });
    if (!profileResponse.ok) return denied('SteamAPIError');
    const profile = (await profileResponse.json()).response?.players?.[0];
    if (!profile || profile.steamid !== steamId) return denied('SteamAPIError');
    const username = typeof profile.personaname === 'string' && profile.personaname.trim() ? profile.personaname.slice(0, 255) : 'Steam User';
    const avatar = typeof profile.avatarfull === 'string' && /^https:\/\//.test(profile.avatarfull) ? profile.avatarfull : null;
    const result = await prisma.$transaction(async tx => {
      const consumed = await tx.steamLoginAttempt.deleteMany({ where: { stateHash: attempt.stateHash, expiresAt: { gt: new Date() } } });
      if (consumed.count !== 1) throw new Error('Consumed authentication attempt');
      let account = await tx.authAccount.findUnique({ where: { provider_providerUserId: { provider: 'steam', providerUserId: steamId } }, include: { user: true } });
      if (userId !== null) {
        if (account && account.userId !== userId) return { conflict: true } as const;
        const user = await tx.user.findUnique({ where: { id: userId } });
        if (!user) throw new Error('User no longer exists');
        if (!account) account = await tx.authAccount.create({ data: { provider: 'steam', providerUserId: steamId, userId }, include: { user: true } });
        if (!user.avatarUrl && avatar) await tx.user.update({ where: { id: userId }, data: { avatarUrl: avatar } });
      } else if (!account) {
        await tx.user.create({ data: { username, avatarUrl: avatar, accounts: { create: { provider: 'steam', providerUserId: steamId } } } });
        account = await tx.authAccount.findUniqueOrThrow({ where: { provider_providerUserId: { provider: 'steam', providerUserId: steamId } }, include: { user: true } });
        // The nested create and unique provider identity bind this account to
        // the new user within the same serializable transaction.
      }
      const owner = account!.user;
      await writeApiAudit(tx, { principal: { kind: 'user', userId: owner.id, permissions: {} }, correlationId: randomUUID(), method: 'GET', path: '/api/auth/steam-callback' }, { action: userId === null ? 'auth.steam.signed_in' : 'auth.steam.linked', resource: 'auth_account', resourceId: String(account!.id), targetUserIds: [owner.id], outcome: 'success' });
      const grants = await tx.userPermission.findMany({ where: { userId: owner.id }, select: { value: true, permission: { select: { key: true } } } });
      return { conflict: false, user: owner, permissions: Object.fromEntries(grants.map(grant => [grant.permission.key, grant.value])) } as const;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    if (result.conflict) return denySteam(config, 'SteamAlreadyLinked', '/profile');
    try { await processPendingEventsForUser(steamId, null, result.user.id, { principal: { kind: 'user', userId: result.user.id, permissions: {} }, correlationId: randomUUID(), method: 'GET', path: '/api/auth/steam-callback' }); } catch { console.error('Steam attendance backfill failed'); }
    if (userId !== null) return finish(config.base, config.cookie, config.secure, '/profile?success=SteamLinked');
    const token = await encode({ token: { sub: steamId, provider: 'steam', id: result.user.id, username: result.user.username, email: result.user.email, createdAt: result.user.createdAt, permissions: result.permissions }, secret: config.secret, maxAge: 30 * 86400 });
    const response = finish(config.base, config.cookie, config.secure, '/orbats');
    response.cookies.set(config.secure ? '__Secure-next-auth.session-token' : 'next-auth.session-token', token, { httpOnly: true, secure: config.secure, sameSite: 'lax', path: '/', maxAge: 30 * 86400 });
    return response;
  } catch { return denied('SteamAuthError'); }
}
