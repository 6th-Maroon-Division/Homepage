import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => {
  const model = () => ({ findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() });
  return { session: vi.fn(), audit: vi.fn(), db: { user: model(), botToken: model(), discordIntegration: model(), discordConfigurationRevision: model(), discordBulkRoleAction: model(), discordBulkRolePage: model(), discordCommand: model(), discordModerationCase: model(), rankDiscordRole: model(), $transaction: vi.fn() } };
});
vi.mock('@/lib/prisma', () => ({ prisma: mocks.db }));
vi.mock('next-auth', () => ({ getServerSession: mocks.session }));
vi.mock('@/app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
vi.mock('@/lib/api/audit', () => ({ writeApiAudit: mocks.audit }));
import { GET, POST } from '@/app/api/discord/bulk-roles/route';
import { GET as detail } from '@/app/api/discord/bulk-roles/[id]/route';
import { POST as snapshot } from '@/app/api/discord/bulk-roles/[id]/snapshot/route';
import { POST as confirm } from '@/app/api/discord/bulk-roles/[id]/confirm/route';
import { POST as targets } from '@/app/api/discord/bulk-roles/[id]/targets/route';
import { POST as outcomes } from '@/app/api/discord/bulk-roles/[id]/outcomes/route';
import { POST as claim } from '@/app/api/discord/commands/claim/route';
import { POST as complete } from '@/app/api/discord/commands/[id]/complete/route';
import { POST as retry } from '@/app/api/discord/commands/[id]/retry/route';
import { defaultSettings } from '@/lib/discord/config';
const guild = '111111111111111111', role = '222222222222222222', member = '333333333333333333', other = '444444444444444444';
const req = (body?: unknown, bot = false, query = '') => new Request(`http://localhost/api/discord/bulk-roles${query}`, { method: body === undefined ? 'GET' : 'POST', headers: bot ? { authorization: 'Bearer token' } : {}, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const context = { params: Promise.resolve({ id: '1' }) };
const grants = (...keys: string[]) => ({ userPermissions: keys.map(key => ({ permission: { key }, value: 1 })) });
const settings = () => ({ ...defaultSettings(), guildId: guild, defaultRoleIds: [role] });
const command = (kind = 'bulk.preview') => ({ id: kind === 'bulk.preview' ? 10 : 11, kind, payload: { bulkRequestKey: 'bulk-request-one' }, requestedBy: 4, permission: 'discord:configure', status: 'running', claimToken: 'claim', claimedBy: 9, generation: 1, leaseUntil: new Date(Date.now() + 300000), createdAt: new Date(), updatedAt: new Date(), result: null, errorCode: null });
const plan = () => ({ id: 1, requestKey: 'bulk-request-one', guildId: guild, configRevision: 4, action: 'apply_defaults', roleIds: [role], requestedBy: 4, status: 'preview_pending', version: 1, nextPage: 0, memberCount: 0, previewCommandId: 10, executeCommandId: null as number | null, expiresAt: new Date(Date.now() + 900000), createdAt: new Date(), updatedAt: new Date() });
const page = () => ({ id: 2, actionId: 1, page: 0, memberIds: [member, other], final: true, outcomes: null });
const credentials = { claimToken: 'claim', generation: 1 };
const upload = () => ({ ...credentials, page: 0, memberIds: [member, other], final: true });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ user: { id: 4 } });
  mocks.db.user.findUnique.mockResolvedValue(grants('system:super_admin'));
  mocks.db.botToken.findFirst.mockResolvedValue({ id: 9 });
  mocks.db.discordIntegration.findUnique.mockResolvedValue({ revision: 4, settings: { settings: settings() } });
  mocks.db.rankDiscordRole.findMany.mockResolvedValue([]);
  mocks.db.discordBulkRoleAction.findUnique.mockResolvedValue(plan());
  mocks.db.discordBulkRoleAction.findMany.mockResolvedValue([]);
  mocks.db.discordBulkRoleAction.create.mockImplementation(({ data }) => ({ ...plan(), ...data }));
  mocks.db.discordBulkRoleAction.update.mockImplementation(({ data }) => ({ ...plan(), ...data }));
  mocks.db.discordBulkRolePage.findUnique.mockResolvedValue(null);
  mocks.db.discordBulkRolePage.findMany.mockResolvedValue([]);
  mocks.db.discordBulkRolePage.create.mockImplementation(({ data }) => ({ id: 2, ...data }));
  mocks.db.discordBulkRolePage.update.mockImplementation(({ data }) => ({ ...page(), ...data }));
  mocks.db.discordCommand.findUnique.mockResolvedValue(command());
  mocks.db.discordCommand.findFirst.mockResolvedValue(null);
  mocks.db.discordCommand.create.mockImplementation(({ data }) => ({ ...command(), ...data }));
  mocks.db.discordCommand.update.mockImplementation(({ data }) => ({ ...command(), ...data }));
  mocks.db.discordModerationCase.findMany.mockResolvedValue([]);
  mocks.db.$transaction.mockImplementation(fn => fn(mocks.db));
});
describe('reviewed bulk role previews', () => {
  it('requires browser configure permission to request and confirm', async () => {
    mocks.session.mockResolvedValue(null); expect((await POST(req({}))).status).toBe(401);
    mocks.session.mockResolvedValue({ user: { id: 4 } }); mocks.db.user.findUnique.mockResolvedValue(grants('discord:view'));
    expect((await POST(req({}))).status).toBe(403);
    expect((await POST(req({}, true))).status).toBe(403);
    expect((await confirm(req({}, true), context)).status).toBe(403);
  });
  it('queues a default-role preview without changing Discord roles', async () => {
    mocks.db.discordBulkRoleAction.findUnique.mockResolvedValue(null); mocks.db.discordCommand.findUnique.mockResolvedValue(null);
    const response = await POST(req({ requestKey: 'bulk-request-one', action: 'apply_defaults' }));
    expect(response.status).toBe(202); expect((await response.json()).data.roleIds).toEqual([role]);
    expect(mocks.db.discordCommand.create).toHaveBeenCalledWith({ data: expect.objectContaining({ kind: 'bulk.preview', payload: { bulkRequestKey: 'bulk-request-one' } }) });
  });
  it('replays a matching request and rejects changed actors or actions', async () => {
    expect((await POST(req({ requestKey: 'bulk-request-one', action: 'apply_defaults' }))).status).toBe(202);
    expect((await POST(req({ requestKey: 'bulk-request-one', action: 'remove_menu_role', roleId: other }))).status).toBe(409);
    mocks.db.discordBulkRoleAction.findUnique.mockResolvedValue({ ...plan(), requestedBy: 5 });
    expect((await POST(req({ requestKey: 'bulk-request-one', action: 'apply_defaults' }))).status).toBe(409);
  });
  it.each([{ requestKey: 'bad', action: 'apply_defaults' }, { requestKey: 'valid-key', action: 'arbitrary' }, { requestKey: 'valid-key', action: 'remove_menu_role' }, { requestKey: 'valid-key', action: 'apply_defaults', roleId: role }])('rejects invalid preview %j', async input => expect((await POST(req(input))).status).toBe(422));
  it('allows historical menu roles but blocks never-configured or newly privileged roles', async () => {
    mocks.db.discordBulkRoleAction.findUnique.mockResolvedValue(null); mocks.db.discordCommand.findUnique.mockResolvedValue(null);
    const input = { requestKey: 'bulk-request-one', action: 'remove_menu_role', roleId: other };
    expect((await POST(req(input))).status).toBe(422);
    mocks.db.discordConfigurationRevision.findFirst.mockResolvedValue({ revision: 1 });
    expect((await POST(req(input))).status).toBe(202);
    mocks.db.rankDiscordRole.findMany.mockResolvedValue([{ discordRoleId: other }]);
    expect((await POST(req(input))).status).toBe(409);
    mocks.db.rankDiscordRole.findMany.mockResolvedValue([]);
    mocks.db.discordIntegration.findUnique.mockResolvedValue({ revision: 4, settings: { settings: { ...settings(), exemptRoleIds: [other] } } });
    expect((await POST(req(input))).status).toBe(409);
  });
  it('rejects missing config and empty defaults', async () => {
    mocks.db.discordBulkRoleAction.findUnique.mockResolvedValue(null); mocks.db.discordIntegration.findUnique.mockResolvedValue(null);
    expect((await POST(req({ requestKey: 'valid-key', action: 'apply_defaults' }))).status).toBe(409);
    mocks.db.discordIntegration.findUnique.mockResolvedValue({ revision: 4, settings: { settings: { ...settings(), defaultRoleIds: [] } } });
    expect((await POST(req({ requestKey: 'valid-key', action: 'apply_defaults' }))).status).toBe(409);
  });
  it('lists and reviews bounded pages with audit, validating filters', async () => {
    mocks.db.discordBulkRoleAction.findMany.mockResolvedValue([plan()]);
    expect((await GET(req(undefined, false, '?requestKey=bulk-request-one'))).status).toBe(200);
    expect((await GET(req(undefined, false, '?requestKey=bad'))).status).toBe(400);
    mocks.db.discordBulkRolePage.findUnique.mockResolvedValue(page());
    expect((await (await detail(req(undefined, false, '?page=0'), context)).json()).data.page.memberIds).toEqual([member, other]);
    expect((await detail(req(undefined, false, '?page=-1'), context)).status).toBe(400);
    mocks.db.discordBulkRoleAction.findUnique.mockResolvedValue(null);
    expect((await detail(req(), context)).status).toBe(404);
  });
});
describe('claim-bound bot snapshots', () => {
  it('seals a final page and completes only the preview command', async () => {
    expect((await snapshot(req(upload(), true), context)).status).toBe(200);
    expect(mocks.db.discordCommand.update).toHaveBeenCalledWith({ where: { id: 10 }, data: { status: 'succeeded', result: {}, errorCode: null, leaseUntil: null } });
    expect(mocks.db.discordBulkRoleAction.update).toHaveBeenCalledWith({ where: { id: 1 }, data: expect.objectContaining({ status: 'ready', memberCount: { increment: 2 } }) });
  });
  it('supports exact final-page transport replay, rejects changed members and stale claim', async () => {
    mocks.db.discordBulkRolePage.findUnique.mockResolvedValue(page());
    mocks.db.discordCommand.findUnique.mockResolvedValue({ ...command(), status: 'succeeded', leaseUntil: null });
    expect((await snapshot(req(upload(), true), context)).status).toBe(200);
    expect((await snapshot(req({ ...upload(), memberIds: [member] }, true), context)).status).toBe(409);
    expect((await snapshot(req({ ...upload(), claimToken: 'old' }, true), context)).status).toBe(409);
  });
  it('enforces page order, uniqueness, limit and configuration freshness', async () => {
    expect((await snapshot(req({ ...upload(), page: 1 }, true), context)).status).toBe(409);
    expect((await snapshot(req({ ...upload(), memberIds: [member, member] }, true), context)).status).toBe(422);
    expect((await snapshot(req({ ...upload(), memberIds: Array(101).fill(member) }, true), context)).status).toBe(422);
    mocks.db.discordBulkRolePage.findMany.mockResolvedValue([{ memberIds: [member] }]);
    expect((await snapshot(req(upload(), true), context)).status).toBe(422);
    mocks.db.discordBulkRolePage.findMany.mockResolvedValue([]);
    mocks.db.discordIntegration.findUnique.mockResolvedValue({ revision: 5, settings: { settings: settings() } });
    expect((await snapshot(req(upload(), true), context)).status).toBe(409);
  });
  it('rejects expired claims, revoked administrators, expired previews and protected defaults', async () => {
    mocks.db.discordCommand.findUnique.mockResolvedValue({ ...command(), leaseUntil: new Date(0) });
    expect((await snapshot(req(upload(), true), context)).status).toBe(409);
    mocks.db.discordCommand.findUnique.mockResolvedValue(command()); mocks.db.user.findUnique.mockResolvedValue(grants());
    expect((await snapshot(req(upload(), true), context)).status).toBe(403);
    mocks.db.user.findUnique.mockResolvedValue(grants('discord:configure')); mocks.db.discordBulkRoleAction.findUnique.mockResolvedValue({ ...plan(), expiresAt: new Date(0) });
    expect((await snapshot(req(upload(), true), context)).status).toBe(409);
    mocks.db.discordBulkRoleAction.findUnique.mockResolvedValue(plan()); mocks.db.rankDiscordRole.findMany.mockResolvedValue([{ discordRoleId: role }]);
    expect((await snapshot(req(upload(), true), context)).status).toBe(409);
  });
});
describe('bulk confirmation and execution', () => {
  it('requires exact reviewed version and queues an immutable execution', async () => {
    mocks.db.discordBulkRoleAction.findUnique.mockResolvedValue({ ...plan(), status: 'ready', memberCount: 2, nextPage: 1, version: 2 });
    mocks.db.discordCommand.findUnique.mockResolvedValue(null);
    expect((await confirm(req({ version: 1, requestKey: 'execute-key' }), context)).status).toBe(409);
    expect((await confirm(req({ version: 2, requestKey: 'execute-key' }), context)).status).toBe(202);
    expect(mocks.db.discordCommand.create).toHaveBeenCalledWith({ data: expect.objectContaining({ kind: 'bulk.execute' }) });
    expect((await confirm(req({ version: '2', requestKey: 'execute-key' }), context)).status).toBe(422);
  });
  it('replays confirmation only for the same reviewer, version and request key', async () => {
    mocks.db.discordBulkRoleAction.findUnique.mockResolvedValue({ ...plan(), status: 'queued', memberCount: 2, nextPage: 1, version: 3, executeCommandId: 11 });
    mocks.db.discordCommand.findUnique.mockResolvedValue({ ...command('bulk.execute'), requestKey: 'bulk-execute-execute-key' });
    expect((await confirm(req({ version: 2, requestKey: 'execute-key' }), context)).status).toBe(202);
    expect((await confirm(req({ version: 2, requestKey: 'other-key' }), context)).status).toBe(409);
  });
  it('filters honeypot bans immediately before execution and prevents revoked access', async () => {
    mocks.db.discordBulkRoleAction.findUnique.mockResolvedValue({ ...plan(), status: 'queued', executeCommandId: 11 });
    mocks.db.discordCommand.findUnique.mockResolvedValue(command('bulk.execute')); mocks.db.discordBulkRolePage.findUnique.mockResolvedValue(page());
    mocks.db.discordModerationCase.findMany.mockResolvedValue([{ memberId: member }]);
    const response = await targets(req({ ...credentials, page: 0 }, true), context);
    expect((await response.json()).data).toMatchObject({ memberIds: [other], skippedBanMemberIds: [member] });
    mocks.db.user.findUnique.mockResolvedValue(grants());
    expect((await targets(req({ ...credentials, page: 0 }, true), context)).status).toBe(403);
  });
  it('requires exactly one bounded immutable outcome for each reviewed member', async () => {
    mocks.db.discordBulkRoleAction.findUnique.mockResolvedValue({ ...plan(), status: 'queued', executeCommandId: 11 });
    mocks.db.discordCommand.findUnique.mockResolvedValue(command('bulk.execute')); mocks.db.discordBulkRolePage.findUnique.mockResolvedValue(page());
    const reported = [{ memberId: member, status: 'skipped' }, { memberId: other, status: 'applied' }];
    expect((await outcomes(req({ ...credentials, page: 0, outcomes: reported.slice(1) }, true), context)).status).toBe(422);
    expect((await outcomes(req({ ...credentials, page: 0, outcomes: reported }, true), context)).status).toBe(200);
    mocks.db.discordBulkRolePage.findUnique.mockResolvedValue({ ...page(), outcomes: reported });
    expect((await outcomes(req({ ...credentials, page: 0, outcomes: reported }, true), context)).status).toBe(200);
    expect((await outcomes(req({ ...credentials, page: 0, outcomes: reported.map(entry => ({ ...entry, status: 'skipped' })) }, true), context)).status).toBe(409);
  });
  it('cannot acknowledge preview or execute success before all members have outcomes', async () => {
    expect((await complete(req({ ...credentials, success: true, result: {} }, true), { params: Promise.resolve({ id: '10' }) })).status).toBe(409);
    mocks.db.discordCommand.findUnique.mockResolvedValue(command('bulk.execute'));
    mocks.db.discordBulkRoleAction.findUnique.mockResolvedValue({ ...plan(), status: 'queued', executeCommandId: 11, nextPage: 1 });
    mocks.db.discordBulkRolePage.findMany.mockResolvedValue([page()]);
    const finish = () => complete(req({ ...credentials, success: true, result: {} }, true), { params: Promise.resolve({ id: '11' }) });
    expect((await finish()).status).toBe(409);
    mocks.db.discordBulkRolePage.findMany.mockResolvedValue([{ ...page(), outcomes: [{ memberId: member, status: 'applied' }, { memberId: other, status: 'skipped' }] }]);
    expect((await finish()).status).toBe(200);
    expect(mocks.db.discordBulkRoleAction.update).toHaveBeenCalledWith({ where: { id: 1 }, data: { status: 'succeeded' } });
  });
  it('cancels stale bulk commands at claim and requires fresh review after failure', async () => {
    mocks.db.discordCommand.findFirst.mockResolvedValue(command());
    expect((await claim(req({}, true))).status).toBe(200);
    mocks.db.discordBulkRoleAction.findUnique.mockResolvedValue({ ...plan(), expiresAt: new Date(0) });
    expect((await (await claim(req({}, true))).json()).data).toBeNull();
    mocks.db.discordCommand.findUnique.mockResolvedValue({ ...command(), status: 'failed' });
    expect((await retry(req({}), { params: Promise.resolve({ id: '10' }) })).status).toBe(409);
  });
});

describe('manual join-role retry queue safety', () => {
  const joinCommand = () => ({ ...command('join.retry'), kind: 'join.retry', payload: { operationId: 1, memberId: member, guildId: guild, configRevision: 4 } });
  it('cancels a retry when a honeypot ban exists before claim', async () => {
    mocks.db.discordCommand.findFirst.mockResolvedValue(joinCommand());
    mocks.db.discordModerationCase.findFirst.mockResolvedValue({ id: 9, status: 'failed' });
    expect((await (await claim(req({}, true))).json()).data).toBeNull();
    expect(mocks.db.discordCommand.update).toHaveBeenCalledWith({ where: { id: 11 }, data: expect.objectContaining({ status: 'cancelled', errorCode: 'honeypot_ban' }) });
  });
  it('requires current revision and requesting administrator retry permission', async () => {
    mocks.db.discordCommand.findFirst.mockResolvedValue(joinCommand());
    mocks.db.user.findUnique.mockResolvedValue(grants('discord:configure'));
    expect((await (await claim(req({}, true))).json()).data).toBeNull();
    expect(mocks.db.discordCommand.update.mock.lastCall![0].data.errorCode).toBe('permission_revoked');
    mocks.db.user.findUnique.mockResolvedValue(grants('discord:configure', 'discord:retry'));
    mocks.db.discordIntegration.findUnique.mockResolvedValue({ revision: 5, settings: { settings: settings() } });
    expect((await (await claim(req({}, true))).json()).data).toBeNull();
    expect(mocks.db.discordCommand.update.mock.lastCall![0].data.errorCode).toBe('configuration_changed');
    mocks.db.discordIntegration.findUnique.mockResolvedValue({ revision: 4, settings: { settings: settings() } });
    expect((await (await claim(req({}, true))).json()).data.status).toBe('running');
  });
  it('requires a fresh explicit operation retry rather than replaying old payload after failure', async () => {
    mocks.db.discordCommand.findUnique.mockResolvedValue({ ...joinCommand(), status: 'failed' });
    expect((await retry(req({}), context)).status).toBe(409);
    expect(mocks.db.discordCommand.update).not.toHaveBeenCalled();
  });
});
