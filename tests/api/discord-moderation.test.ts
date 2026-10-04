import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => {
  const model = () => ({ findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() });
  return { session: vi.fn(), db: { user: model(), botToken: model(), discordIntegration: model(), discordCommand: model(), discordModerationCase: model(), discordEvidence: model(), apiAuditLog: model(), $transaction: vi.fn() } };
});
vi.mock('@/lib/prisma', () => ({ prisma: mocks.db }));
vi.mock('next-auth', () => ({ getServerSession: mocks.session }));
vi.mock('@/app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
import { GET as cases, POST as intake } from '@/app/api/discord/cases/route';
import { GET as getCase, PATCH as updateCase } from '@/app/api/discord/cases/[id]/route';
import { POST as release } from '@/app/api/discord/cases/[id]/release/route';
import { GET as evidence, POST as capture } from '@/app/api/discord/evidence/route';
import { PATCH as evidenceAction } from '@/app/api/discord/evidence/[id]/route';
import { maintainDiscordEvidence, RECOVERY_MS } from '@/lib/discord/evidence-maintenance';
import { defaultSettings } from '@/lib/discord/config';
const now = new Date('2026-09-20T12:00:00Z');
const guildId = '123456789012345678';
const memberId = '234567890123456789';
const roleId = '345678901234567890';
const channelId = '456789012345678901';
const triggerId = '567890123456789012';
const mc = { id: 1, guildId, memberId, triggerId, occurredAt: now, configRevision: 1, action: 'timeout', status: 'applied', timeoutUntil: new Date(now.getTime() + 86400000), releasedAt: null };
const attachment = { name: 'evidence.txt', contentType: 'text/plain', dataBase64: 'dGVzdA==' };
const er = { id: 1, caseId: 1, messageId: triggerId, channelId, authorId: memberId, sentAt: now, content: 'private evidence', attachments: [attachment], capturedAt: now, expiresAt: new Date(now.getTime() + RECOVERY_MS), indefinite: false, deletedAt: null, recoverUntil: null, purgedAt: null, version: 1 };
const req = (method = 'GET', body: unknown = {}, bot = false, query = '') => new Request(`http://localhost/api/discord/evidence${query}`, { method, headers: bot ? { authorization: 'Bearer token' } : {}, ...(method === 'GET' ? {} : { body: JSON.stringify(body) }) });
const ctx = () => ({ params: Promise.resolve({ id: '1' }) });
const grants = (...keys: string[]) => mocks.db.user.findUnique.mockResolvedValue({ userPermissions: keys.map(key => ({ permission: { key }, value: 1 })) });
const trigger = { triggerId, guildId, memberId, roleIds: [roleId], configRevision: 1, occurredAt: now.toISOString() };
const upload = { caseId: 1, messageId: triggerId, channelId, authorId: memberId, sentAt: now.toISOString(), content: er.content, attachments: [attachment] };
const settings = () => ({ ...defaultSettings(), guildId, honeypotEnabled: true, membershipRoleIds: [roleId] });
beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(now);
  mocks.session.mockResolvedValue({ user: { id: 4 } });
  grants('system:super_admin');
  mocks.db.botToken.findFirst.mockResolvedValue({ id: 9 });
  mocks.db.discordIntegration.findUnique.mockResolvedValue({ revision: 1, settings: { settings: settings(), retention: { mode: 'days', days: 7 } } });
  mocks.db.discordModerationCase.findUnique.mockResolvedValue(mc);
  mocks.db.discordModerationCase.findMany.mockResolvedValue([mc]);
  mocks.db.discordModerationCase.create.mockImplementation(async ({ data }) => ({ ...mc, ...data }));
  mocks.db.discordModerationCase.update.mockImplementation(async ({ data }) => ({ ...mc, ...data }));
  mocks.db.discordEvidence.findUnique.mockResolvedValue(er);
  mocks.db.discordEvidence.findMany.mockResolvedValue([er]);
  mocks.db.discordEvidence.create.mockImplementation(async ({ data }) => ({ ...er, ...data }));
  mocks.db.discordEvidence.update.mockImplementation(async ({ data }) => ({ ...er, ...data, version: 2 }));
  mocks.db.discordEvidence.updateMany.mockResolvedValue({ count: 1 });
  mocks.db.discordCommand.findUnique.mockResolvedValue(null);
  mocks.db.discordCommand.findFirst.mockResolvedValue(null);
  mocks.db.discordCommand.create.mockImplementation(async ({ data }) => ({ id: 1, status: 'pending', generation: 1, createdAt: now, updatedAt: now, ...data }));
  mocks.db.$transaction.mockImplementation(async cb => cb(mocks.db));
});

afterEach(() => vi.useRealTimers());

describe('moderation credentials and independent capabilities', () => {
  it('requires bot authentication for case creation, updates, and evidence capture', async () => {
    expect((await intake(req('POST', trigger))).status).toBe(403);
    expect((await updateCase(req('PATCH', { status: 'applied' }), ctx())).status).toBe(403);
    expect((await capture(req('POST', upload))).status).toBe(403);
  });
  it('rejects missing and revoked credentials', async () => {
    mocks.session.mockResolvedValue(null);
    expect((await cases(req())).status).toBe(401);
    mocks.db.botToken.findFirst.mockResolvedValue(null);
    expect((await intake(req('POST', trigger, true))).status).toBe(401);
  });
  it('moderation review does not confer access to evidence content or timeout release', async () => {
    grants('discord:moderation_view');
    expect((await cases(req())).status).toBe(200);
    expect((await evidence(req())).status).toBe(403);
    expect((await release(req('POST', { requestKey: 'release-one' }), ctx())).status).toBe(403);
  });
  it.each([['delete', 'discord:evidence_delete'], ['restore', 'discord:evidence_restore'], ['indefinite', 'discord:evidence_retention']])('requires both evidence view and %s capability', async (action, permission) => {
    grants(permission);
    expect((await evidenceAction(req('PATCH', { action, version: 1 }), ctx())).status).toBe(403);
    grants('discord:evidence_view');
    expect((await evidenceAction(req('PATCH', { action, version: 1 }), ctx())).status).toBe(403);
    expect(mocks.db.discordEvidence.update).not.toHaveBeenCalled();
  });
  it('makes evidence responses private and audits access without copying content into audit', async () => {
    grants('discord:evidence_view');
    const response = await evidence(req());
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect((await response.json()).data[0].content).toBe(er.content);
    expect(JSON.stringify(mocks.db.apiAuditLog.create.mock.calls)).not.toContain(er.content);
    expect(mocks.db.apiAuditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'discord.evidence.read', after: { ids: [1] } }) });
  });
});

describe('honeypot case decisions and release', () => {
  it.each([[roleId, 'timeout'], [null, 'ban']])('classifies configured membership %s as %s', async (role, action) => {
    mocks.db.discordModerationCase.findUnique.mockResolvedValue(null);
    const response = await intake(req('POST', { ...trigger, roleIds: role ? [role] : [] }, true));
    expect(response.status).toBe(201);
    expect((await response.json()).data.action).toBe(action);
  });
  it('exemptions override membership and stale configuration cannot create a case', async () => {
    mocks.db.discordModerationCase.findUnique.mockResolvedValue(null);
    mocks.db.discordIntegration.findUnique.mockResolvedValue({ revision: 1, settings: { settings: { ...settings(), exemptUserIds: [memberId] } } });
    expect((await (await intake(req('POST', trigger, true))).json()).data.action).toBe('exempt');
    expect((await intake(req('POST', { ...trigger, configRevision: 0 }, true))).status).toBe(409);
  });
  it('does not punish an exempt/released case or downgrade a confirmed punishment', async () => {
    for (const overrides of [{ action: 'exempt' }, { releasedAt: now }, { status: 'applied' }]) {
      mocks.db.discordModerationCase.findUnique.mockResolvedValue({ ...mc, ...overrides });
      expect((await updateCase(req('PATCH', { status: 'failed' }, true), ctx())).status).toBe(409);
    }
  });
  it('queues early release without pretending the timeout is already released', async () => {
    mocks.db.discordModerationCase.findUnique.mockResolvedValue({ ...mc, timeoutUntil: new Date(Date.now() + 365 * 86400000) });
    grants('discord:timeout_release');
    expect((await release(req('POST', { requestKey: 'release-one' }), ctx())).status).toBe(202);
    expect(mocks.db.discordCommand.create).toHaveBeenCalledWith({ data: expect.objectContaining({ kind: 'timeout.release', payload: { caseId: 1, memberId, guildId } }) });
    expect(mocks.db.discordModerationCase.update).not.toHaveBeenCalled();
  });
  it.each(['pending', 'applied', 'failed', 'released'])('reports cleanup independently of %s punishment', async status => {
    const existing = { ...mc, status, releasedAt: status === 'released' ? now : null };
    const cleanup = { scanned: 2, deleted: 1, failed: 1, messages: [{ messageId: triggerId, status: 'inaccessible', errorCode: 'missing_permission' }] };
    mocks.db.discordModerationCase.findUnique.mockResolvedValue(existing);
    mocks.db.discordModerationCase.update.mockImplementation(async ({ data }) => ({ ...existing, ...data }));
    const response = await updateCase(req('PATCH', { cleanup }, true), ctx());
    expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject({ status, releasedAt: existing.releasedAt?.toISOString() ?? null, timeoutUntil: mc.timeoutUntil.toISOString(), cleanup });
    expect(mocks.db.discordModerationCase.update).toHaveBeenCalledWith({ where: { id: 1 }, data: { cleanup } });
    expect(mocks.db.apiAuditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'discord.case.updated', after: { status } }) });
  });
  it('keeps cleanup reports bot-only and refuses empty updates or hidden punishment changes', async () => {
    expect((await updateCase(req('PATCH', { cleanup: { deleted: 1 } }), ctx())).status).toBe(403);
    for (const payload of [{}, { cleanup: { deleted: -1 } }, { cleanup: {}, appliedAt: now.toISOString() }, { cleanup: {}, timeoutUntil: mc.timeoutUntil.toISOString() }]) {
      expect((await updateCase(req('PATCH', payload, true), ctx())).status).toBe(422);
    }
    mocks.db.discordModerationCase.findUnique.mockResolvedValue({ ...mc, status: 'released', releasedAt: now });
    expect((await updateCase(req('PATCH', { status: 'applied', cleanup: { deleted: 1 } }, true), ctx())).status).toBe(409);
    expect(mocks.db.discordModerationCase.update).not.toHaveBeenCalled();
  });
  it('rejects release for bans and already released timeouts', async () => {
    for (const overrides of [{ action: 'ban' }, { releasedAt: now }]) {
      mocks.db.discordModerationCase.findUnique.mockResolvedValue({ ...mc, ...overrides });
      expect((await release(req('POST', { requestKey: 'release-one' }), ctx())).status).toBe(409);
    }
  });
});

describe('evidence intake and recovery', () => {
  it('stores attachment bytes and applies configured indefinite retention', async () => {
    mocks.db.discordEvidence.findUnique.mockResolvedValue(null);
    mocks.db.discordIntegration.findUnique.mockResolvedValue({ settings: { settings: settings(), retention: { mode: 'indefinite', days: null } } });
    const response = await capture(req('POST', upload, true));
    expect(response.status).toBe(201);
    expect(mocks.db.discordEvidence.create).toHaveBeenCalledWith({ data: expect.objectContaining({ indefinite: true, expiresAt: null, content: er.content, attachments: [attachment] }) });
    expect((await response.json()).data).not.toHaveProperty('content');
  });
  it('rejects other authors, messages outside the 30-minute window, and malformed attachments', async () => {
    for (const overrides of [{ authorId: roleId }, { sentAt: new Date(now.getTime() - 1800001).toISOString() }, { sentAt: new Date(now.getTime() + 1).toISOString() }, { attachments: [{ ...attachment, dataBase64: 'invalid!' }] }]) {
      expect((await capture(req('POST', { ...upload, ...overrides }, true))).status).toBe(422);
    }
    expect(mocks.db.discordEvidence.create).not.toHaveBeenCalled();
  });
  it('deduplicates identical captures but does not overwrite or resurrect deleted evidence', async () => {
    expect((await capture(req('POST', upload, true))).status).toBe(201);
    expect((await capture(req('POST', { ...upload, content: 'altered' }, true))).status).toBe(409);
    mocks.db.discordEvidence.findUnique.mockResolvedValue({ ...er, deletedAt: now });
    expect((await capture(req('POST', upload, true))).status).toBe(409);
    expect(mocks.db.discordEvidence.create).not.toHaveBeenCalled();
  });
  it('manually deletes indefinite evidence with a full recovery window and intact content', async () => {
    mocks.db.discordEvidence.findUnique.mockResolvedValue({ ...er, indefinite: true, expiresAt: null });
    const response = await evidenceAction(req('PATCH', { version: 1, action: 'delete' }), ctx());
    expect(response.status).toBe(200);
    const update = mocks.db.discordEvidence.update.mock.calls[0][0].data;
    expect(update.recoverUntil.getTime() - update.deletedAt.getTime()).toBe(RECOVERY_MS);
    expect(update).not.toHaveProperty('content');
    expect(update).not.toHaveProperty('attachments');
  });
  it.each([false, true])('restores recoverable evidence, preserving indefinite=%s', async indefinite => {
    mocks.db.discordEvidence.findUnique.mockResolvedValue({ ...er, indefinite, deletedAt: now, recoverUntil: new Date('2099-01-01'), expiresAt: new Date(0) });
    const response = await evidenceAction(req('PATCH', { version: 1, action: 'restore' }), ctx());
    expect(response.status).toBe(200);
    const update = mocks.db.discordEvidence.update.mock.calls[0][0].data;
    expect(update).toMatchObject({ deletedAt: null, recoverUntil: null });
    expect(update.expiresAt === null).toBe(indefinite);
    expect(update).not.toHaveProperty('content');
    expect(update).not.toHaveProperty('attachments');
  });
  it('cannot reset deletion deadline, restore expired recovery, or mutate stale versions', async () => {
    mocks.db.discordEvidence.findUnique.mockResolvedValue({ ...er, deletedAt: now, recoverUntil: new Date(0) });
    expect((await evidenceAction(req('PATCH', { version: 1, action: 'delete' }), ctx())).status).toBe(409);
    expect((await evidenceAction(req('PATCH', { version: 1, action: 'restore' }), ctx())).status).toBe(409);
    expect((await evidenceAction(req('PATCH', { version: 1, action: 'indefinite' }), ctx())).status).toBe(409);
    expect((await evidenceAction(req('PATCH', { version: 2, action: 'delete' }), ctx())).status).toBe(409);
  });
  it('marks active evidence indefinite and rejects already purged evidence', async () => {
    expect((await evidenceAction(req('PATCH', { version: 1, action: 'indefinite' }), ctx())).status).toBe(200);
    expect(mocks.db.discordEvidence.update).toHaveBeenCalledWith(expect.objectContaining({ data: { indefinite: true, expiresAt: null, version: { increment: 1 } } }));
    mocks.db.discordEvidence.findUnique.mockResolvedValue({ ...er, purgedAt: now });
    expect((await evidenceAction(req('PATCH', { version: 1, action: 'restore' }), ctx())).status).toBe(409);
  });
});

describe('scheduled evidence lifecycle', () => {
  it('expires finite evidence with seven days to restore and purges both content and attachments after recovery', async () => {
    mocks.db.discordEvidence.findMany.mockResolvedValueOnce([{ id: 1, version: 2 }]).mockResolvedValueOnce([{ id: 2, version: 3 }]);
    expect(await maintainDiscordEvidence(now)).toEqual({ deleted: 1, purged: 1 });
    expect(mocks.db.discordEvidence.findMany.mock.calls[0][0].where).toMatchObject({ indefinite: false, deletedAt: null, purgedAt: null });
    const expiry = mocks.db.discordEvidence.updateMany.mock.calls[0][0];
    expect(expiry.data.recoverUntil.getTime()).toBe(now.getTime() + RECOVERY_MS);
    expect(expiry.data).not.toHaveProperty('content');
    const purge = mocks.db.discordEvidence.updateMany.mock.calls[1][0];
    expect(purge.data).toMatchObject({ content: null, purgedAt: now });
    expect(purge.data).toHaveProperty('attachments');
    expect(purge.where).toMatchObject({ id: 2, version: 3, recoverUntil: { lte: now } });
  });
  it('does not report or audit rows skipped due to concurrent changes', async () => {
    mocks.db.discordEvidence.findMany.mockResolvedValueOnce([{ id: 1, version: 1 }]).mockResolvedValueOnce([]);
    mocks.db.discordEvidence.updateMany.mockResolvedValue({ count: 0 });
    expect(await maintainDiscordEvidence(now)).toEqual({ deleted: 0, purged: 0 });
    expect(mocks.db.apiAuditLog.create).not.toHaveBeenCalled();
  });
});

describe('moderation validation and delivery outcomes', () => {
  it('denies case reads without review capabilities and supports pagination', async () => {
    grants(); expect((await cases(req())).status).toBe(403);
    grants('discord:evidence_view'); expect((await cases(req('GET', {}, false, '?cursor=5&limit=1'))).status).toBe(200);
    expect(mocks.db.discordModerationCase.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: { id: { lt: 5 } } }));
  });
  it('validates trigger identity, timestamp, duplicate binding and feature configuration', async () => {
    expect((await intake(req('POST', { ...trigger, roleIds: ['invalid'] }, true))).status).toBe(422);
    expect((await intake(req('POST', { ...trigger, occurredAt: new Date(now.getTime()+60001).toISOString() }, true))).status).toBe(422);
    expect((await intake(req('POST', trigger, true))).status).toBe(201);
    expect((await intake(req('POST', { ...trigger, memberId: roleId }, true))).status).toBe(409);
    expect((await intake(req('POST', { ...trigger, guildId: roleId }, true))).status).toBe(409);
    mocks.db.discordModerationCase.findUnique.mockResolvedValue(null);
    mocks.db.discordIntegration.findUnique.mockResolvedValue(null);
    expect((await intake(req('POST', trigger, true))).status).toBe(409);
  });
  it('validates cleanup receipts and status', async () => {
    expect((await updateCase(req('PATCH', { status: 'invalid' }, true),ctx())).status).toBe(422);
    for (const cleanup of [null,{other:1},{scanned:-1},{messages:'bad'},{messages:[null]},{messages:[{messageId:triggerId,status:'deleted',extra:1}]},{messages:[{messageId:'bad',status:'deleted'}]},{messages:[{messageId:triggerId,status:'bad'}]},{messages:[{messageId:triggerId,status:'failed',errorCode:4}]},{messages:[{messageId:triggerId,status:'failed',errorCode:'BAD!'}]}]) {
      expect((await updateCase(req('PATCH',{status:'applied',cleanup},true),ctx())).status).toBe(422);
    }
  });
  it('accepts applied timeout receipts only for configured minimum duration', async () => {
    mocks.db.discordModerationCase.findUnique.mockResolvedValue({...mc, configSnapshot:{timeoutHours:48}});
    const appliedAt=now.toISOString(), timeoutUntil=new Date(now.getTime()+48*3600000).toISOString();
    expect((await updateCase(req('PATCH',{status:'applied',appliedAt,timeoutUntil,cleanup:{scanned:1,messages:[{messageId:triggerId,status:'deleted'},{messageId:triggerId,status:'failed',errorCode:'missing_permission'}]}},true),ctx())).status).toBe(200);
    for(const changes of [{appliedAt:new Date(now.getTime()+60001).toISOString()},{appliedAt:new Date(now.getTime()-1).toISOString()},{timeoutUntil:new Date(now.getTime()+24*3600000).toISOString()}]) {
      expect((await updateCase(req('PATCH',{status:'applied',appliedAt,timeoutUntil,...changes},true),ctx())).status).toBe(422);
    }
  });
  it('accepts ban and failed delivery receipts and rejects missing cases', async () => {
    mocks.db.discordModerationCase.findUnique.mockResolvedValue({...mc,action:'ban',status:'pending'});
    expect((await updateCase(req('PATCH',{status:'applied'},true),ctx())).status).toBe(200);
    expect((await updateCase(req('PATCH',{status:'failed'},true),ctx())).status).toBe(200);
    mocks.db.discordModerationCase.findUnique.mockResolvedValue(null);
    expect((await updateCase(req('PATCH',{status:'applied'},true),ctx())).status).toBe(404);
    expect((await release(req('POST',{requestKey:'release-one'}),ctx())).status).toBe(404);
  });
  it('deduplicates release queue and rejects conflicting requests or expired timeouts', async () => {
    mocks.db.discordCommand.findFirst.mockResolvedValue({requestKey:'release-one'});
    expect((await release(req('POST',{requestKey:'release-other'}),ctx())).status).toBe(409);
    expect((await release(req('POST',{requestKey:'release-one'}),ctx())).status).toBe(202);
    for(const timeoutUntil of [null,new Date(0)]) {
      mocks.db.discordModerationCase.findUnique.mockResolvedValue({...mc,timeoutUntil});
      expect((await release(req('POST',{requestKey:'release-one'}),ctx())).status).toBe(409);
    }
  });
});

describe('evidence validation and retention edges', () => {
  it('lists recoverable deleted evidence with case and cursor filters and rejects invalid states', async () => {
    expect((await evidence(req('GET',{},false,'?state=bad'))).status).toBe(400);
    expect((await evidence(req('GET',{},false,'?state=deleted&caseId=1&cursor=5'))).status).toBe(200);
    expect(mocks.db.discordEvidence.findMany).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({caseId:1,id:{lt:5},deletedAt:{not:null},recoverUntil:{gt:expect.any(Date)}})}));
  });
  it('rejects malformed records, excessive attachment bytes, and unknown cases', async () => {
    expect((await capture(req('POST',{...upload,caseId:0},true))).status).toBe(422);
    const bytes=Buffer.alloc(8*1024*1024+1).toString('base64');
    expect((await capture(req('POST',{...upload,attachments:[{...attachment,dataBase64:bytes}]},true))).status).toBe(413);
    mocks.db.discordModerationCase.findUnique.mockResolvedValue(null);
    expect((await capture(req('POST',upload,true))).status).toBe(404);
  });
  it('assigns finite retention to a fresh capture', async () => {
    mocks.db.discordEvidence.findUnique.mockResolvedValue(null);
    expect((await capture(req('POST',upload,true))).status).toBe(201);
    expect(mocks.db.discordEvidence.create).toHaveBeenCalledWith({data:expect.objectContaining({indefinite:false,expiresAt:new Date(now.getTime()+RECOVERY_MS)})});
  });
  it('rejects malformed actions and missing evidence', async () => {
    expect((await evidenceAction(req('PATCH',{version:0,action:'delete'}),ctx())).status).toBe(422);
    mocks.db.discordEvidence.findUnique.mockResolvedValue(null);
    expect((await evidenceAction(req('PATCH',{version:1,action:'delete'}),ctx())).status).toBe(404);
  });
  it('restores finite evidence with absent expiry and rejects missing recovery deadlines', async () => {
    mocks.db.discordEvidence.findUnique.mockResolvedValue({...er,deletedAt:now,recoverUntil:new Date(now.getTime()+RECOVERY_MS),expiresAt:null});
    expect((await evidenceAction(req('PATCH',{version:1,action:'restore'}),ctx())).status).toBe(200);
    for(const changes of [{deletedAt:null},{recoverUntil:null}]) {
      mocks.db.discordEvidence.findUnique.mockResolvedValue({...er,deletedAt:now,recoverUntil:new Date(now.getTime()+RECOVERY_MS),...changes});
      expect((await evidenceAction(req('PATCH',{version:1,action:'restore'}),ctx())).status).toBe(409);
    }
  });
  it('does not audit a purge skipped because another action won the version check', async () => {
    mocks.db.discordEvidence.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([{id:1,version:1}]);
    mocks.db.discordEvidence.updateMany.mockResolvedValue({count:0});
    expect(await maintainDiscordEvidence(now)).toEqual({deleted:0,purged:0});
    expect(mocks.db.apiAuditLog.create).not.toHaveBeenCalled();
  });
});


describe('moderation recovery details and release reasons', () => {
  it('returns an audited case detail without embedding evidence', async () => {
    const response = await getCase(req(), ctx());
    expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject({id: mc.id, action: 'timeout'});
    expect(mocks.db.apiAuditLog.create).toHaveBeenCalled();
    grants('discord:view');
    expect((await getCase(req(), ctx())).status).toBe(403);
    grants('discord:moderation_view');
    mocks.db.discordModerationCase.findUnique.mockResolvedValue(null);
    expect((await getCase(req(), ctx())).status).toBe(404);
  });
  it('preserves optional release reason in the command and rejects invalid reasons', async () => {
    expect((await release(req('POST', {requestKey: 'reason-one', reason: 'Reviewed by moderator'}), ctx())).status).toBe(202);
    expect(mocks.db.discordCommand.create).toHaveBeenCalledWith({data: expect.objectContaining({payload: {caseId: 1, memberId, guildId, reason: 'Reviewed by moderator'}})});
    for (const reason of ['', ' ', 'x'.repeat(501), 1]) expect((await release(req('POST', {requestKey: 'reason-one', reason}), ctx())).status).toBe(422);
  });
});


it('cancels pending and running join retries atomically when the honeypot chooses a ban', async () => {
  mocks.db.discordModerationCase.findUnique.mockResolvedValue(null);
  expect((await intake(req('POST', {...trigger, roleIds: []}, true))).status).toBe(201);
  expect(mocks.db.discordCommand.updateMany).toHaveBeenCalledWith({where: {kind: 'join.retry', status: {in: ['pending', 'running']}, AND: [{payload: {path: ['memberId'], equals: memberId}}, {payload: {path: ['guildId'], equals: guildId}}]}, data: {status: 'cancelled', errorCode: 'honeypot_ban', claimToken: null, leaseUntil: null}});
});
