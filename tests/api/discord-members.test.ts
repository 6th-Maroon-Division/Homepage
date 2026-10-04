import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => {
  const model = () => ({ findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() });
  return { session: vi.fn(), audit: vi.fn(), publish: vi.fn(), signup: vi.fn(), availability: vi.fn(), eligibility: vi.fn(), failure: vi.fn(), db: { botEvent: { create: vi.fn(), deleteMany: vi.fn() }, $transaction: vi.fn(), user: model(), botToken: model(), authAccount: model(), discordIntegration: model(), slot: model(), signup: model() } };
});
vi.mock('@/lib/prisma', () => ({ prisma: mocks.db }));
vi.mock('next-auth', () => ({ getServerSession: mocks.session }));
vi.mock('@/app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
vi.mock('@/lib/api/audit', () => ({ writeApiAudit: mocks.audit }));
vi.mock('@/lib/realtime/user-events', () => ({ publishUserProfileEvent: mocks.publish }));
vi.mock('@/lib/api/signups', () => ({ mutateSignup: mocks.signup, availability: mocks.availability, slotPage: mocks.eligibility, catchFailure: mocks.failure }));
import { GET as members } from '@/app/api/discord/members/route';
import { PATCH as name } from '@/app/api/discord/members/[discordId]/name/route';
import { POST as signup, PATCH as move, DELETE as cancel } from '@/app/api/discord/members/[discordId]/orbats/[id]/signup/route';
import { GET as availability, PATCH as updateAvailability, DELETE as deleteAvailability } from '@/app/api/discord/members/[discordId]/orbats/[id]/availability/route';
import { GET as eligibility } from '@/app/api/discord/members/[discordId]/orbats/[id]/eligibility/route';
import { defaultSettings } from '@/lib/discord/config';
const discordId = '111111111111111111';
const member = { id: 12, username: 'Raven', nameRevision: 3 };
const actor = { kind: 'user', userId: member.id, permissions: {} };
const params = (overrides: { discordId?: string; id?: string } = {}) => ({ params: Promise.resolve({ discordId, id: '8', ...overrides }) });
const req = (method = 'GET', body?: unknown, options: { token?: string | null; key?: string | null; path?: string } = {}) => {
  const headers = new Headers();
  if (options.token !== null) headers.set('Authorization', options.token ?? 'Bearer live');
  if (options.key !== null) headers.set('Idempotency-Key', options.key ?? 'discord-interaction-123');
  return new Request(`http://localhost/api/discord/members${options.path ?? `/${discordId}/orbats/8/signup`}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
};
const enable = (patch: Record<string, unknown> = {}) => mocks.db.discordIntegration.findUnique.mockResolvedValue({ settings: { settings: { ...defaultSettings(), nicknameSync: true, ...patch }, retention: { mode: 'days', days: 7 } } });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue(null);
  mocks.db.botToken.findFirst.mockResolvedValue({ id: 7 });
  mocks.db.authAccount.findUnique.mockResolvedValue({ user: member });
  mocks.db.authAccount.findMany.mockResolvedValue([]);
  mocks.db.slot.findUnique.mockResolvedValue({ orbatId: 8 });
  mocks.db.signup.findUnique.mockResolvedValue({ userId: 12, slot: { orbatId: 8 } });
  mocks.db.user.updateMany.mockResolvedValue({ count: 1 });
  mocks.db.user.findUniqueOrThrow.mockResolvedValue({ ...member, username: 'Falcon', nameRevision: 4 });
  mocks.db.$transaction.mockImplementation(async fn => fn(mocks.db));
  mocks.signup.mockImplementation(async () => Response.json({ data: { id: 29 } }));
  mocks.availability.mockImplementation(async () => Response.json({ data: { status: 'absent' } }));
  mocks.eligibility.mockImplementation(async () => Response.json({ data: [] }));
  enable();
});

describe('Discord member endpoints: transport identity and account resolution', () => {
  it.each([
    ['members', () => members(req('GET', undefined, { token: null, path: '' }))],
    ['name', () => name(req('PATCH', { username: 'Falcon', nameRevision: 3 }, { token: null }), params())],
    ['signup', () => signup(req('POST', { slotId: 6 }, { token: null }), params())],
    ['move', () => move(req('PATCH', { slotId: 6 }, { token: null }), params())],
    ['cancel', () => cancel(req('DELETE', {}, { token: null }), params())],
    ['availability read', () => availability(req('GET', undefined, { token: null }), params())],
    ['availability update', () => updateAvailability(req('PATCH', { status: 'absent' }, { token: null }), params())],
    ['availability delete', () => deleteAvailability(req('DELETE', {}, { token: null }), params())],
    ['eligibility', () => eligibility(req('GET', undefined, { token: null }), params())],
  ])('rejects a superadmin browser session for %s', async (_, call) => {
    mocks.session.mockResolvedValue({ user: { id: 1 } });
    mocks.db.user.findUnique.mockResolvedValue({ userPermissions: [{ value: 255, permission: { key: 'system:super_admin' } }] });
    expect((await call()).status).toBe(403);
    expect(mocks.db.authAccount.findUnique).not.toHaveBeenCalled();
    expect(mocks.signup).not.toHaveBeenCalled();
  });
  it('refuses revoked tokens without trying the session', async () => {
    mocks.db.botToken.findFirst.mockResolvedValue(null);
    expect((await signup(req('POST', { slotId: 6 }), params())).status).toBe(401);
    expect(mocks.session).not.toHaveBeenCalled();
  });
  it('resolves only Discord-linked accounts and rejects invalid identifiers', async () => {
    expect((await signup(req('POST', { slotId: 6 }), params({ discordId: 'bad' }))).status).toBe(400);
    mocks.db.authAccount.findUnique.mockResolvedValue(null);
    expect((await signup(req('POST', { slotId: 6 }), params())).status).toBe(404);
    expect(mocks.db.authAccount.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { provider_providerUserId: { provider: 'discord', providerUserId: discordId } } }));
    expect(mocks.signup).not.toHaveBeenCalled();
  });
  it('lists only Discord accounts and audits member-data reads without contact fields', async () => {
    mocks.db.authAccount.findMany.mockResolvedValue([{ id: 50, providerUserId: discordId, user: { ...member, userRank: null } }]);
    const response = await members(req('GET', undefined, { path: `?discordId=${discordId}&limit=1` }));
    expect(response.status).toBe(200);
    const { data } = await response.json();
    expect(data[0]).toMatchObject({ discordId, username: 'Raven', nameRevision: 3 });
    expect(data[0]).not.toHaveProperty('email');
    expect(mocks.db.authAccount.findMany.mock.lastCall![0].where).toEqual({ provider: 'discord', providerUserId: discordId });
    expect(mocks.audit).toHaveBeenCalledWith(mocks.db, expect.anything(), expect.objectContaining({ action: 'user_data.read', targetUserIds: [12] }));
  });
});

describe('Discord signup domain delegation', () => {
  it('passes the linked member with no admin privileges and preserves the interaction key', async () => {
    expect((await signup(req('POST', { slotId: 6 }), params())).status).toBe(200);
    const [request, principal, , method, signupId, allowMove] = mocks.signup.mock.lastCall!;
    expect(principal).toEqual(actor);
    expect(method).toBe('POST'); expect(signupId).toBeUndefined(); expect(allowMove).toBe(true);
    expect(request.headers.get('Idempotency-Key')).toBe('discord-interaction-123');
    expect(await request.json()).toEqual({ slotId: 6 });
  });
  it('passes domain prerequisite failures back unchanged', async () => {
    mocks.signup.mockResolvedValue(Response.json({ error: { code: 'training_required', message: 'Required training missing.' } }, { status: 403 }));
    const response = await signup(req('POST', { slotId: 6 }), params());
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe('training_required');
  });
  it('does not accept a caller-selected user or another member’s signup', async () => {
    expect((await signup(req('POST', { slotId: 6, userId: 99 }), params())).status).toBe(422);
    mocks.db.signup.findUnique.mockResolvedValue({ userId: 99, slot: { orbatId: 8 } });
    expect((await move(req('PATCH', { slotId: 6, signupId: 99 }), params())).status).toBe(403);
    expect(mocks.signup).not.toHaveBeenCalled();
  });
  it('rejects a slot belonging to a different operation', async () => {
    mocks.db.slot.findUnique.mockResolvedValue({ orbatId: 9 });
    expect((await signup(req('POST', { slotId: 6 }), params())).status).toBe(422);
    expect(mocks.signup).not.toHaveBeenCalled();
  });
  it('requires an interaction idempotency key before mutation', async () => {
    expect((await signup(req('POST', { slotId: 6 }, { key: null }), params())).status).toBe(422);
    expect(mocks.signup).not.toHaveBeenCalled();
  });
  it.each([['PATCH', move], ['DELETE', cancel]] as const)('resolves only the linked member’s current signup for %s', async (method, call) => {
    expect((await call(req(method, method === 'DELETE' ? { signupId: 29 } : { signupId: 29, slotId: 6 }), params())).status).toBe(200);
    expect(mocks.db.signup.findUnique).toHaveBeenCalledWith({ where: { id: 29 }, select: { userId: true, slot: { select: { orbatId: true } } } });
    expect(mocks.signup.mock.lastCall!.slice(1)).toEqual([actor, expect.anything(), method, 29, true]);
  });
  it('passes a missing stable signup ID to canonical idempotency handling for cancellation retries', async () => {
    mocks.db.signup.findUnique.mockResolvedValue(null);
    expect((await cancel(req('DELETE', { signupId: 29 }), params())).status).toBe(200);
    const [request, principal, , method, signupId] = mocks.signup.mock.lastCall!;
    expect(principal).toEqual(actor); expect(method).toBe('DELETE'); expect(signupId).toBe(29);
    expect(request.headers.get('Idempotency-Key')).toBe('discord-interaction-123');
    expect(await request.json()).toEqual({});
  });
  it('rejects a signup owned by the member in a different operation', async () => {
    mocks.db.signup.findUnique.mockResolvedValue({ userId: 12, slot: { orbatId: 9 } });
    expect((await cancel(req('DELETE', { signupId: 29 }), params())).status).toBe(403);
    expect(mocks.signup).not.toHaveBeenCalled();
  });
  it('requires stable signup IDs for moves and cancellations', async () => {
    expect((await move(req('PATCH', { slotId: 6 }), params())).status).toBe(422);
    expect((await cancel(req('DELETE', {}), params())).status).toBe(422);
    expect(mocks.signup).not.toHaveBeenCalled();
  });
  it('honors disabled signup interactions before calling the domain', async () => {
    enable({ signupEnabled: false });
    expect((await signup(req('POST', { slotId: 6 }), params())).status).toBe(409);
    expect((await eligibility(req(), params())).status).toBe(409);
    expect(mocks.signup).not.toHaveBeenCalled(); expect(mocks.eligibility).not.toHaveBeenCalled();
  });
});

describe('Discord availability and eligibility use website policy', () => {
  it.each([['GET', availability], ['PATCH', updateAvailability], ['DELETE', deleteAvailability]] as const)('delegates availability %s as the linked member', async (method, call) => {
    expect((await call(req(method, method === 'GET' ? undefined : { status: 'absent', notes: 'Away' }), params())).status).toBe(200);
    const [, principal, , orbatId, targetId, passedMethod] = mocks.availability.mock.lastCall!;
    expect(principal).toEqual(actor); expect(orbatId).toBe(8); expect(targetId).toBe('12'); expect(passedMethod).toBe(method);
  });
  it('preserves validation errors from website availability', async () => {
    mocks.availability.mockResolvedValue(Response.json({ error: { code: 'validation_failed' } }, { status: 422 }));
    expect((await updateAvailability(req('PATCH', { notes: 'invalid' }), params())).status).toBe(422);
  });
  it('uses a member actor for eligibility, never the token’s superadmin grants', async () => {
    expect((await eligibility(req(), params())).status).toBe(200);
    expect(mocks.eligibility).toHaveBeenCalledWith(expect.any(Request), 8, actor, expect.anything());
  });
  it('blocks disabled availability without changing website records', async () => {
    enable({ availabilityEnabled: false });
    expect((await updateAvailability(req('PATCH', { status: 'absent' }), params())).status).toBe(409);
    expect(mocks.availability).not.toHaveBeenCalled();
  });
});

describe('Discord name synchronization revision safety', () => {
  it('accepts moderator attribution, normalizes the base name, and increments its revision atomically', async () => {
    const moderator = '222222222222222222';
    expect((await name(req('PATCH', { username: ' Falcon ', nameRevision: 3, actorDiscordId: moderator }), params())).status).toBe(200);
    expect(mocks.db.user.updateMany).toHaveBeenCalledWith({ where: { id: 12, nameRevision: 3 }, data: { username: 'Falcon', nameRevision: { increment: 1 } } });
    expect(mocks.db.botEvent.create).toHaveBeenCalledWith({data:{type:'member.name.changed',aggregate:'member',aggregateId:'12',payload:{userId:12,discordUserId:discordId,nameRevision:4}}});
    expect(mocks.audit).toHaveBeenCalledWith(mocks.db, expect.anything(), expect.objectContaining({ action: 'discord.name.updated', after: { username: 'Falcon', actorDiscordId: moderator } }));
    expect(mocks.publish).toHaveBeenCalledWith(12, { source: 'user.updated' });
  });
  it('rejects stale events without publishing a reverted name', async () => {
    mocks.db.user.updateMany.mockResolvedValue({ count: 0 });
    expect((await name(req('PATCH', { username: 'Old name', nameRevision: 2 }), params())).status).toBe(409);
    expect(mocks.db.user.findUniqueOrThrow).not.toHaveBeenCalled(); expect(mocks.publish).not.toHaveBeenCalled();
  });
  it.each([{ username: '', nameRevision: 3 }, { username: 'x'.repeat(51), nameRevision: 3 }, { username: 'Name', nameRevision: -1 }, { username: 'Name', nameRevision: 3, actorDiscordId: 'invalid' }, { username: 'Name', nameRevision: 3, email: 'private@example.com' }])('rejects invalid profile update %j', async payload => {
    expect((await name(req('PATCH', payload), params())).status).toBe(422);
    expect(mocks.db.user.updateMany).not.toHaveBeenCalled();
  });
  it.each([{ nicknameSync: false }, { syncExemptUserIds: [discordId] }])('honors name synchronization settings %j', async patch => {
    enable(patch);
    expect((await name(req('PATCH', { username: 'Falcon', nameRevision: 3 }), params())).status).toBe(409);
    expect(mocks.db.user.updateMany).not.toHaveBeenCalled();
  });
});

describe('Discord member reconciliation edge cases', () => {
  it('rejects a malformed list filter without exposing account records', async () => {
    expect((await members(req('GET', undefined, { path: '?discordId=invalid' }))).status).toBe(400);
    expect(mocks.db.authAccount.findMany).not.toHaveBeenCalled();
  });
  it('continues ascending member reconciliation without a specific account filter', async () => {
    const response = await members(req('GET', undefined, { path: '?cursor=50&limit=10' }));
    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual([]);
    expect(mocks.db.authAccount.findMany.mock.lastCall![0]).toMatchObject({ where: { provider: 'discord', id: { gt: 50 } }, orderBy: { id: 'asc' } });
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it('records unattributed nickname changes and tolerates a missed realtime event', async () => {
    mocks.publish.mockImplementation(() => { throw new Error('Event feed unavailable'); });
    expect((await name(req('PATCH', { username: 'Falcon', nameRevision: 3 }), params())).status).toBe(200);
    expect(mocks.audit).toHaveBeenCalledWith(mocks.db, expect.anything(), expect.objectContaining({ after: { username: 'Falcon', actorDiscordId: null } }));
  });
  it.each([undefined, 0, -1, '6'])('rejects invalid signup slot ID %j before mutation', async slotId => {
    expect((await signup(req('POST', { slotId }), params())).status).toBe(422);
    expect(mocks.signup).not.toHaveBeenCalled();
    expect(mocks.db.slot.findUnique).not.toHaveBeenCalled();
  });
});

it('translates structured domain conflicts without elevating the Discord member', async () => {
  const conflict = { status: 409, code: 'slot_full', message: 'Slot filled during selection.' };
  mocks.signup.mockRejectedValue(conflict);
  mocks.failure.mockReturnValue(Response.json({ error: conflict }, { status: 409 }));
  const response = await signup(req('POST', { slotId: 6 }), params());
  expect(response.status).toBe(409);
  expect((await response.json()).error.code).toBe('slot_full');
  expect(mocks.failure).toHaveBeenCalledWith(conflict);
});

it('audits successful member reads with the bot identity and never audits rejected reads as success', async () => {
  expect((await availability(req(), params())).status).toBe(200);
  expect(mocks.audit).toHaveBeenLastCalledWith(mocks.db, expect.objectContaining({ principal: expect.objectContaining({ kind: 'bot', tokenId: 7 }) }), expect.objectContaining({ action: 'user_data.read', resource: 'orbat_availability', targetUserIds: [member.id] }));
  expect((await eligibility(req(), params())).status).toBe(200);
  expect(mocks.audit).toHaveBeenLastCalledWith(mocks.db, expect.anything(), expect.objectContaining({ resource: 'orbat_eligibility' }));
  mocks.audit.mockClear();
  mocks.eligibility.mockResolvedValue(Response.json({ error: 'unavailable' }, { status: 409 }));
  expect((await eligibility(req(), params())).status).toBe(409);
  expect(mocks.audit).not.toHaveBeenCalled();
});
