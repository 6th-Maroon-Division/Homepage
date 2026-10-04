import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => {
  const model = () => ({ findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), upsert: vi.fn() });
  return { session: vi.fn(), db: { user: model(), botToken: model(), discordIntegration: model(), discordCommand: model(), discordOperation: model(), discordAnnouncement: model(), discordRoleMenuMessage: model(), discordModerationCase: model(), orbat: model(), apiAuditLog: model(), $transaction: vi.fn() } };
});
vi.mock('@/lib/prisma', () => ({ prisma: mocks.db }));
vi.mock('next-auth', () => ({ getServerSession: mocks.session }));
vi.mock('@/app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
import { POST as retryOperation } from '@/app/api/discord/operations/[id]/retry/route';
import { GET, POST } from '@/app/api/discord/commands/route';
import { POST as claim } from '@/app/api/discord/commands/claim/route';
import { POST as complete } from '@/app/api/discord/commands/[id]/complete/route';
import { POST as lease } from '@/app/api/discord/commands/[id]/lease/route';
import { POST as retry } from '@/app/api/discord/commands/[id]/retry/route';
import { GET as getAnnouncement, POST as announce } from '@/app/api/discord/announcements/[id]/route';
import { defaultSettings } from '@/lib/discord/config';
const channelId = '123456789012345678';
const messageId = '234567890123456789';
const now = new Date();
const row = { id: 1, kind: 'welcome.test', payload: {}, requestKey: 'request-one', permission: 'discord:configure', requestedBy: 4, status: 'pending', generation: 1, claimToken: null, claimedBy: null, leaseUntil: null, result: null, errorCode: null, createdAt: now, updatedAt: now };
const req = (method = 'POST', body: unknown = {}, bot = false, query = '') => new Request(`http://localhost/api/discord/commands${query}`, { method, headers: bot ? { authorization: 'Bearer token' } : {}, ...(method === 'GET' ? {} : { body: JSON.stringify(body) }) });
const ctx = (id = '1') => ({ params: Promise.resolve({ id }) });
const user = (...permissions: string[]) => ({ userPermissions: permissions.map(key => ({ permission: { key }, value: 1 })) });
const input = { requestKey: 'request-one', action: 'publish', channelId, mention: 'none', missionText: 'Mission briefing' };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ user: { id: 4 } });
  mocks.db.user.findUnique.mockResolvedValue(user('system:super_admin'));
  mocks.db.botToken.findFirst.mockResolvedValue({ id: 9 });
  mocks.db.discordIntegration.findUnique.mockResolvedValue({ settings: { settings: { ...defaultSettings(), guildId: channelId, welcomeChannelId: channelId, announcementsEnabled: true }, retention: { mode: 'days', days: 7 } } });
  mocks.db.discordCommand.findUnique.mockResolvedValue(null);
  mocks.db.discordCommand.findFirst.mockResolvedValue(null);
  mocks.db.discordCommand.findMany.mockResolvedValue([]);
  mocks.db.discordCommand.create.mockImplementation(async ({ data }) => ({ ...row, ...data }));
  mocks.db.discordCommand.update.mockImplementation(async ({ data }) => ({ ...row, ...data, generation: typeof data.generation === 'object' ? 2 : data.generation ?? 1 }));
  mocks.db.discordAnnouncement.findUnique.mockResolvedValue(null);
  mocks.db.orbat.findUnique.mockResolvedValue({ id: 1 });
  mocks.db.$transaction.mockImplementation(async cb => cb(mocks.db));
});

describe('Discord command permissions and queue', () => {
  it('rejects unauthenticated and zero permission callers', async () => {
    mocks.session.mockResolvedValue(null);
    expect((await GET(req('GET'))).status).toBe(401);
    mocks.session.mockResolvedValue({ user: { id: 4 } });
    mocks.db.user.findUnique.mockResolvedValue(user());
    expect((await POST(req('POST', { requestKey: 'request-one', kind: 'welcome.test', payload: {} }))).status).toBe(403);
    expect(mocks.db.discordCommand.create).not.toHaveBeenCalled();
  });
  it('filters listed command types by delegated permissions and hides payload/lease secrets', async () => {
    mocks.db.user.findUnique.mockResolvedValue(user('discord:configure'));
    mocks.db.discordCommand.findMany.mockResolvedValue([{ ...row, claimToken: 'secret' }]);
    const response = await GET(req('GET'));
    expect(response.status).toBe(200);
    const { data } = await response.json();
    expect(data[0]).not.toHaveProperty('claimToken');
    expect(data[0]).not.toHaveProperty('payload');
    expect(mocks.db.discordCommand.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { kind: { in: ['bulk.preview', 'bulk.execute', 'menu.publish', 'welcome.test', 'sync.all'] } } }));
  });
  it('queues an explicit action and audits it in a serializable transaction', async () => {
    expect((await POST(req('POST', { requestKey: 'request-one', kind: 'welcome.test', payload: {} }))).status).toBe(202);
    expect(mocks.db.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'Serializable', timeout: 30000 });
    expect(mocks.db.apiAuditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'discord.command.queued', actorUserId: 4 }) });
  });
  it('deduplicates identical submissions and rejects reusing a key for another actor or action', async () => {
    mocks.db.discordCommand.findUnique.mockResolvedValue(row);
    const submit = () => POST(req('POST', { requestKey: 'request-one', kind: 'welcome.test', payload: {} }));
    expect((await submit()).status).toBe(202);
    expect(mocks.db.discordCommand.create).not.toHaveBeenCalled();
    mocks.db.discordCommand.findUnique.mockResolvedValue({ ...row, requestedBy: 5 });
    expect((await submit()).status).toBe(409);
  });
  it.each([
    { requestKey: 'request-one', kind: 'announcement.publish', payload: {} },
    { requestKey: 'request-one', kind: 'welcome.test', payload: { channelId } },
    { requestKey: 'x', kind: 'welcome.test', payload: {} },
  ])('rejects invalid or unauthorized generic command shape %j', async payload => {
    expect((await POST(req('POST', payload))).status).toBe(422);
    expect(mocks.db.discordCommand.create).not.toHaveBeenCalled();
  });
});

describe('worker claims and completion', () => {
  it('requires a bot token for claims and acknowledgements', async () => {
    expect((await claim(req())).status).toBe(403);
    expect((await complete(req(), ctx())).status).toBe(403);
    expect((await claim(req('POST', {}, true))).status).toBe(200);
  });
  it('cancels a queued action when the requester loses permission', async () => {
    mocks.db.discordCommand.findFirst.mockResolvedValue(row);
    mocks.db.user.findUnique.mockResolvedValue(user());
    expect((await (await claim(req('POST', {}, true))).json()).data).toBeNull();
    expect(mocks.db.discordCommand.update).toHaveBeenCalledWith({ where: { id: 1 }, data: expect.objectContaining({ status: 'cancelled', errorCode: 'permission_revoked' }) });
  });
  it('claims authorized work with a token-bound expiring lease', async () => {
    mocks.db.discordCommand.findFirst.mockResolvedValue(row);
    const response = await claim(req('POST', {}, true));
    expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject({ status: 'running', claimToken: expect.any(String), payload: {} });
    expect(mocks.db.discordCommand.update).toHaveBeenCalledWith({ where: { id: 1 }, data: expect.objectContaining({ claimedBy: 9, leaseUntil: expect.any(Date) }) });
  });
  it.each([
    { claimToken: 'other' }, { generation: 2 }, { claimedBy: 10 }, { leaseUntil: new Date(0) },
  ])('rejects superseded/expired completion %j', async override => {
    mocks.db.discordCommand.findUnique.mockResolvedValue({ ...row, status: 'running', claimedBy: 9, claimToken: 'claim-one', leaseUntil: new Date(Date.now() + 60000), ...override });
    expect((await complete(req('POST', { claimToken: 'claim-one', generation: 1, success: true, result: {} }, true), ctx())).status).toBe(409);
    expect(mocks.db.discordCommand.update).not.toHaveBeenCalled();
  });
  it('requires matching channel confirmation before attaching an announcement message', async () => {
    mocks.db.discordCommand.findUnique.mockResolvedValue({ ...row, kind: 'announcement.publish', payload: { orbatId: 1, channelId }, status: 'running', claimedBy: 9, claimToken: 'claim-one', leaseUntil: new Date(Date.now() + 60000) });
    const ack = (result: object) => complete(req('POST', { claimToken: 'claim-one', generation: 1, success: true, result }, true), ctx());
    expect((await ack({ messageId })).status).toBe(422);
    expect(mocks.db.discordAnnouncement.update).not.toHaveBeenCalled();
    expect((await ack({ messageId, channelId })).status).toBe(200);
    expect(mocks.db.discordAnnouncement.update).toHaveBeenCalledWith({ where: { orbatId: 1 }, data: { messageId, missingAt: null, renderedRevision: null, lastRenderedAt: null } });
  });
});

describe('manual retries', () => {
  it('requires retry and original action permission', async () => {
    mocks.db.discordCommand.findUnique.mockResolvedValue({ ...row, status: 'failed' });
    mocks.db.user.findUnique.mockResolvedValue(user('discord:retry'));
    expect((await retry(req(), ctx())).status).toBe(403);
    mocks.db.user.findUnique.mockResolvedValue(user('discord:retry', 'discord:configure'));
    expect((await retry(req(), ctx())).status).toBe(202);
    expect(mocks.db.discordCommand.update).toHaveBeenCalledWith({ where: { id: 1 }, data: expect.objectContaining({ status: 'pending', generation: { increment: 1 }, claimToken: null }) });
  });
  it('does not retry running work or already released timeouts', async () => {
    mocks.db.discordCommand.findUnique.mockResolvedValue({ ...row, status: 'running' });
    expect((await retry(req(), ctx())).status).toBe(409);
    mocks.db.discordCommand.findUnique.mockResolvedValue({ ...row, kind: 'timeout.release', status: 'failed', payload: { caseId: 2 } });
    mocks.db.discordModerationCase.findUnique.mockResolvedValue({ releasedAt: now });
    expect((await retry(req(), ctx())).status).toBe(409);
  });
});

describe('ORBAT announcements', () => {
  it('requires both announcement and ORBAT edit permissions', async () => {
    mocks.db.user.findUnique.mockResolvedValue(user('discord:announce'));
    expect((await getAnnouncement(req('GET'), ctx())).status).toBe(403);
    expect((await announce(req('POST', input), ctx())).status).toBe(403);
    mocks.db.user.findUnique.mockResolvedValue(user('discord:announce', 'orbat:edit'));
    expect((await getAnnouncement(req('GET'), ctx())).status).toBe(200);
  });
  it('loading configuration does not publish automatically', async () => {
    const response = await getAnnouncement(req('GET'), ctx());
    expect(await response.json()).toMatchObject({ data: { announcement: null, config: { announcementsEnabled: true }, commands: [] } });
    expect(mocks.db.discordCommand.create).not.toHaveBeenCalled();
  });
  it('queues publication and stores editable announcement state', async () => {
    expect((await announce(req('POST', input), ctx())).status).toBe(202);
    expect(mocks.db.discordCommand.create).toHaveBeenCalledWith({ data: expect.objectContaining({ kind: 'announcement.publish', payload: { orbatId: 1, channelId, mention: 'none', missionText: 'Mission briefing' } }) });
    expect(mocks.db.discordAnnouncement.upsert).toHaveBeenCalled();
  });
  it('blocks disallowed mentions, duplicate active work, and refresh before delivery', async () => {
    expect((await announce(req('POST', { ...input, mention: 'everyone' }), ctx())).status).toBe(422);
    expect((await announce(req('POST', { ...input, action: 'refresh' }), ctx())).status).toBe(409);
    mocks.db.discordCommand.findFirst.mockResolvedValue(row);
    expect((await announce(req('POST', input), ctx())).status).toBe(409);
    expect(mocks.db.discordAnnouncement.upsert).not.toHaveBeenCalled();
  });
  it('refreshes a delivered message, but rejects duplicate publish and channel moves', async () => {
    mocks.db.discordAnnouncement.findUnique.mockResolvedValue({ orbatId: 1, channelId, messageId });
    expect((await announce(req('POST', input), ctx())).status).toBe(409);
    expect((await announce(req('POST', { ...input, action: 'refresh', channelId: messageId }), ctx())).status).toBe(409);
    expect((await announce(req('POST', { ...input, action: 'refresh' }), ctx())).status).toBe(202);
    expect(mocks.db.discordCommand.create).toHaveBeenCalledWith({ data: expect.objectContaining({ kind: 'announcement.refresh' }) });
  });
});


describe('worker lease renewal', () => {
  it('only renews a current, unexpired bot-owned lease', async () => {
    const payload = { claimToken: 'claim-one', generation: 1 };
    expect((await lease(req('POST', payload), ctx())).status).toBe(403);
    mocks.db.discordCommand.updateMany.mockResolvedValue({ count: 1 });
    expect((await lease(req('POST', payload, true), ctx())).status).toBe(200);
    expect(mocks.db.discordCommand.updateMany).toHaveBeenCalledWith({ where: expect.objectContaining({ id: 1, status: 'running', claimToken: 'claim-one', generation: 1, claimedBy: 9, leaseUntil: { gt: expect.any(Date) } }), data: { leaseUntil: expect.any(Date) } });
    mocks.db.discordCommand.updateMany.mockResolvedValue({ count: 0 });
    expect((await lease(req('POST', payload, true), ctx())).status).toBe(409);
  });
});

describe('announcement regression guards', () => {
  it('does not list announcement commands without ORBAT edit permission', async () => {
    mocks.db.user.findUnique.mockResolvedValue(user('discord:announce'));
    expect((await GET(req('GET'))).status).toBe(200);
    expect(mocks.db.discordCommand.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { kind: { in: [] } } }));
  });
  it('rejects retrying an announcement superseded by newer work', async () => {
    mocks.db.discordCommand.findUnique.mockResolvedValue({ ...row, status: 'failed', kind: 'announcement.refresh', payload: { orbatId: 1 } });
    mocks.db.discordCommand.findFirst.mockResolvedValue({ ...row, id: 2 });
    expect((await retry(req(), ctx())).status).toBe(409);
    expect(mocks.db.discordCommand.update).not.toHaveBeenCalled();
  });
  it('accepts identical completion repeats but rejects changing a completed result', async () => {
    mocks.db.discordCommand.findUnique.mockResolvedValue({ ...row, status: 'succeeded', claimToken: 'claim-one', claimedBy: 9, result: { messageId, channelId }, errorCode: null });
    const ack = (result: object) => complete(req('POST', { claimToken: 'claim-one', generation: 1, success: true, result }, true), ctx());
    expect((await ack({ messageId, channelId })).status).toBe(200);
    expect((await ack({ messageId: channelId, channelId })).status).toBe(409);
    expect(mocks.db.discordCommand.update).not.toHaveBeenCalled();
  });
});

describe('command contract and state edge cases', () => {
  it('accepts bot-created queue work, checks configuration, and validates menu payload keys', async () => {
    expect((await POST(req('POST',{requestKey:'request-bot',kind:'welcome.test',payload:{}},true))).status).toBe(202);
    expect((await POST(req('POST',{requestKey:'request-one',kind:'menu.publish',payload:{unknown:true}}))).status).toBe(422);
    expect((await POST(req('POST',{requestKey:'request-one',kind:'menu.publish',payload:{menuId:'games'}}))).status).toBe(404);
    mocks.db.discordIntegration.findUnique.mockResolvedValue(null);
    expect((await POST(req('POST',{requestKey:'request-one',kind:'welcome.test',payload:{}}))).status).toBe(409);
    mocks.db.discordIntegration.findUnique.mockResolvedValue({settings:{settings:{...defaultSettings(),guildId:channelId}}});
    expect((await POST(req('POST',{requestKey:'request-one',kind:'welcome.test',payload:{}}))).status).toBe(409);
    expect((await POST(req('POST',{requestKey:'request-one',kind:'sync.all',payload:{}}))).status).toBe(409);
    for(const enabled of ['nicknameSync','rankRoleSync']) {
      mocks.db.discordIntegration.findUnique.mockResolvedValue({settings:{settings:{...defaultSettings(),guildId:channelId,[enabled]:true}}});
      expect((await POST(req('POST',{requestKey:'request-one',kind:'sync.all',payload:{}}))).status).toBe(202);
    }
    mocks.db.discordIntegration.findUnique.mockResolvedValue({settings:{settings:{...defaultSettings(),guildId:channelId,menus:[{id:'games'}]}}});
    expect((await POST(req('POST',{requestKey:'request-one',kind:'menu.publish',payload:{menuId:'games'}}))).status).toBe(202);
  });
  it('deduplicates bot submissions and supports listing cursor', async () => {
    mocks.db.discordCommand.findUnique.mockResolvedValue({...row,requestedBy:null});
    expect((await POST(req('POST',{requestKey:'request-one',kind:'welcome.test',payload:{}},true))).status).toBe(202);
    expect((await GET(req('GET',{},false,'?cursor=5'))).status).toBe(200);
  });
  it('rejects retry and completion for unknown actions', async () => {
    expect((await retry(req(),ctx())).status).toBe(404);
    expect((await complete(req('POST',{claimToken:'one',generation:1,success:false,result:{}},true),ctx())).status).toBe(404);
  });
  it('retries a current failed announcement and unreleased timeout with bot attribution', async () => {
    for(const command of [{kind:'announcement.refresh',payload:{orbatId:1}},{kind:'timeout.release',payload:{caseId:1}}]) {
      mocks.db.discordCommand.findUnique.mockResolvedValue({...row,status:'failed',...command});
      mocks.db.discordModerationCase.findUnique.mockResolvedValue({releasedAt:null});
      expect((await retry(req('POST',{},true),ctx())).status).toBe(202);
    }
    mocks.db.discordModerationCase.findUnique.mockResolvedValue(null);
    expect((await retry(req(),ctx())).status).toBe(409);
  });
  it('claims bot-originated commands and cancels missing or revoked requesters', async () => {
    mocks.db.discordCommand.findFirst.mockResolvedValue({...row,requestedBy:null});
    expect((await claim(req('POST',{},true))).status).toBe(200);
    mocks.db.discordCommand.findFirst.mockResolvedValue(row);
    mocks.db.user.findUnique.mockResolvedValue(null);
    expect((await (await claim(req('POST',{},true))).json()).data).toBeNull();
    mocks.db.user.findUnique.mockResolvedValue(user('discord:announce'));
    mocks.db.discordCommand.findFirst.mockResolvedValue({...row,kind:'announcement.refresh',permission:'discord:announce'});
    expect((await (await claim(req('POST',{},true))).json()).data).toBeNull();
  });
  it('cancels obsolete timeout releases but claims still-active ones', async () => {
    mocks.db.discordCommand.findFirst.mockResolvedValue({...row,kind:'timeout.release',payload:{caseId:1}});
    for(const mc of [null,{releasedAt:new Date()}]) {
      mocks.db.discordModerationCase.findUnique.mockResolvedValue(mc);
      expect((await (await claim(req('POST',{},true))).json()).data).toBeNull();
    }
    mocks.db.discordModerationCase.findUnique.mockResolvedValue({releasedAt:null});
    expect((await (await claim(req('POST',{},true))).json()).data.status).toBe('running');
  });
  it('validates acknowledgements and lease request fields', async () => {
    expect((await complete(req('POST',{},true),ctx())).status).toBe(422);
    expect((await complete(req('POST',{claimToken:'one',generation:1,success:false,result:{},errorCode:'Bad!'},true),ctx())).status).toBe(422);
    expect((await complete(req('POST',{claimToken:'one',generation:1,success:false,result:{},errorCode:23},true),ctx())).status).toBe(422);
    expect((await lease(req('POST',{},true),ctx())).status).toBe(422);
  });
  it('records failed results with default and explicit errors and validates duplicate errors', async () => {
    const current={...row,status:'running',claimToken:'one',claimedBy:9,leaseUntil:new Date(Date.now()+60000)};
    for(const errorCode of [undefined,'missing_permission']) {
      mocks.db.discordCommand.findUnique.mockResolvedValue(current);
      const payload={claimToken:'one',generation:1,success:false,result:{},...(errorCode?{errorCode}:{})};
      expect((await complete(req('POST',payload,true),ctx())).status).toBe(200);
      mocks.db.discordCommand.findUnique.mockResolvedValue({...current,status:'failed',result:{},errorCode:errorCode??'discord_action_failed'});
      expect((await complete(req('POST',payload,true),ctx())).status).toBe(200);
    }
  });
  it('confirms timeout release only on a successful acknowledgement', async () => {
    mocks.db.discordCommand.findUnique.mockResolvedValue({...row,kind:'timeout.release',payload:{caseId:1},status:'running',claimToken:'one',claimedBy:9,leaseUntil:new Date(Date.now()+60000)});
    expect((await complete(req('POST',{claimToken:'one',generation:1,success:true,result:{}},true),ctx())).status).toBe(200);
    expect(mocks.db.discordModerationCase.update).toHaveBeenCalledWith({where:{id:1},data:{status:'released',releasedAt:expect.any(Date)}});
  });
});

describe('announcement state validation', () => {
  it('handles unknown operations and malformed actions', async () => {
    mocks.db.orbat.findUnique.mockResolvedValue(null);
    expect((await getAnnouncement(req('GET'),ctx())).status).toBe(404);
    mocks.db.orbat.findUnique.mockResolvedValue({id:1});
    expect((await announce(req('POST',{}),ctx())).status).toBe(422);
    mocks.db.discordIntegration.findUnique.mockResolvedValue(null);
    expect((await announce(req('POST',input),ctx())).status).toBe(409);
  });
  it('returns existing delivery receipts without changing the announcement', async () => {
    mocks.db.discordCommand.findMany.mockResolvedValue([row]);
    expect((await (await getAnnouncement(req('GET'),ctx())).json()).data.commands).toHaveLength(1);
    mocks.db.discordCommand.findUnique.mockResolvedValue({...row,kind:'announcement.publish',payload:{orbatId:1,channelId,mention:'none',missionText:input.missionText}});
    expect((await announce(req('POST',input),ctx())).status).toBe(202);
    expect(mocks.db.discordAnnouncement.upsert).not.toHaveBeenCalled();
  });
});

it('rejects unknown commands and invalid persisted permission grants during execution', async () => {
  const { authorizeCommand } = await import('@/lib/api/discord/commands');
  expect(() => authorizeCommand({ kind: 'user', userId: 4, permissions: { 'system:super_admin': 1 } }, 'unknown.action')).toThrow('Unsupported Discord action');
  mocks.db.discordCommand.findFirst.mockResolvedValue(row);
  mocks.db.user.findUnique.mockResolvedValue(user('removed:permission'));
  expect((await (await claim(req('POST', {}, true))).json()).data).toBeNull();
  expect(mocks.db.discordCommand.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'cancelled', errorCode: 'permission_revoked' }) }));
});


describe('role menu message confirmations', () => {
  const ack = (result: object) => complete(req('POST', { claimToken: 'menu-claim', generation: 1, success: true, result }, true), ctx());
  beforeEach(() => {
    mocks.db.discordCommand.findUnique.mockResolvedValue({ ...row, kind: 'menu.publish', payload: { menuId: 'games' }, status: 'running', claimToken: 'menu-claim', claimedBy: 9, leaseUntil: new Date(Date.now() + 60000) });
    mocks.db.discordIntegration.findUnique.mockResolvedValue({ settings: { settings: { ...defaultSettings(), menus: [{ id: 'games', channelId }] } } });
    mocks.db.discordRoleMenuMessage.findUnique.mockResolvedValue(null);
  });
  it('requires actual message and configured channel before accepting success', async () => {
    expect((await ack({})).status).toBe(422);
    expect((await ack({ messageId, channelId: messageId })).status).toBe(422);
    expect(mocks.db.discordRoleMenuMessage.upsert).not.toHaveBeenCalled();
    expect((await ack({ messageId, channelId })).status).toBe(200);
    expect(mocks.db.discordRoleMenuMessage.upsert).toHaveBeenCalledWith({ where: { menuId_channelId: { menuId: 'games', channelId } }, create: { menuId: 'games', channelId, messageId, lastCommandId: 1 }, update: { messageId, lastCommandId: 1 } });
  });
  it('does not let a late older command overwrite a newer message reference', async () => {
    mocks.db.discordRoleMenuMessage.findUnique.mockResolvedValue({ lastCommandId: 2 });
    expect((await ack({ messageId, channelId })).status).toBe(200);
    expect(mocks.db.discordRoleMenuMessage.upsert).not.toHaveBeenCalled();
  });
  it('rejects confirmation after the menu was removed', async () => {
    mocks.db.discordIntegration.findUnique.mockResolvedValue(null);
    expect((await ack({ messageId, channelId })).status).toBe(422);
  });
});


describe('exhausted join-role retry', () => {
  beforeEach(() => {
    mocks.db.discordOperation.findUnique.mockResolvedValue({id: 1, kind: 'join.roles', status: 'failed', guildId: channelId, memberId: messageId});
    mocks.db.discordModerationCase.findFirst.mockResolvedValue(null);
    mocks.db.discordIntegration.findUnique.mockResolvedValue({revision: 4, settings: {settings: {...defaultSettings(), guildId: channelId, defaultRoleIds: [channelId]}}});
  });
  it('queues only an explicit retry and leaves the original report immutable', async () => {
    expect((await retryOperation(req('POST', {requestKey: 'join-retry-one'}), ctx())).status).toBe(202);
    expect(mocks.db.discordCommand.create).toHaveBeenCalledWith({data: expect.objectContaining({kind: 'join.retry', payload: {operationId: 1, memberId: messageId, guildId: channelId, configRevision: 4}})});
    expect(mocks.db.discordOperation.update).not.toHaveBeenCalled();
  });
  it('requires both retry and configuration grants', async () => {
    mocks.db.user.findUnique.mockResolvedValue(user('discord:retry'));
    expect((await retryOperation(req('POST', {requestKey: 'join-retry-one'}), ctx())).status).toBe(403);
    mocks.db.user.findUnique.mockResolvedValue(user('discord:configure'));
    expect((await retryOperation(req('POST', {requestKey: 'join-retry-one'}), ctx())).status).toBe(403);
  });
  it('refuses bans, duplicate active work, and unrelated outcomes', async () => {
    mocks.db.discordModerationCase.findFirst.mockResolvedValue({action: 'ban', status: 'failed'});
    expect((await retryOperation(req('POST', {requestKey: 'join-retry-one'}), ctx())).status).toBe(409);
    mocks.db.discordModerationCase.findFirst.mockResolvedValue(null);
    mocks.db.discordCommand.findFirst.mockResolvedValue({requestKey: 'other-retry'});
    expect((await retryOperation(req('POST', {requestKey: 'join-retry-one'}), ctx())).status).toBe(409);
    mocks.db.discordOperation.findUnique.mockResolvedValue({kind: 'welcome', status: 'failed'});
    expect((await retryOperation(req('POST', {requestKey: 'join-retry-one'}), ctx())).status).toBe(409);
    mocks.db.discordOperation.findUnique.mockResolvedValue(null);
    expect((await retryOperation(req('POST', {requestKey: 'join-retry-one'}), ctx())).status).toBe(404);
  });
});
