import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => {
  const model = () => ({ findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn(), upsert: vi.fn(), create: vi.fn() });
  return { session: vi.fn(), db: { user: model(), botToken: model(), discordIntegration: model(), discordAnnouncement: model(), discordCommand: model(), orbat: model(), apiAuditLog: model(), $transaction: vi.fn() } };
});
vi.mock('@/lib/prisma', () => ({ prisma: mocks.db }));
vi.mock('next-auth', () => ({ getServerSession: mocks.session }));
vi.mock('@/app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
import { GET, POST } from '@/app/api/discord/announcements/[id]/render/route';
import { POST as publish } from '@/app/api/discord/announcements/[id]/route';
import { POST as complete } from '@/app/api/discord/commands/[id]/complete/route';
import { defaultSettings } from '@/lib/discord/config';
const channelId = '123456789012345678', messageId = '234567890123456789';
const context = (id = '1') => ({ params: Promise.resolve({ id }) });
const request = (input?: unknown, bot = true, query = '') => new Request(`http://localhost/api/discord/announcements/1/render${query}`, { method: input === undefined ? 'GET' : 'POST', headers: bot ? { authorization: 'Bearer token' } : {}, ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
let announcement: Record<string, unknown>, orbat: Record<string, unknown>, settings: ReturnType<typeof defaultSettings>;
beforeEach(() => {
  vi.resetAllMocks();
  settings = { ...defaultSettings(), announcementsEnabled: true, websiteUrl: 'https://unit.example', guildId: '345678901234567890' };
  announcement = { id: 1, orbatId: 1, channelId, messageId, missionText: 'Mission!', renderedRevision: null, lastRenderedAt: null, missingAt: null };
  orbat = { id: 1, name: 'Mission', description: 'Public briefing', eventDate: null, startsAtUtc: null, endsAtUtc: null, startTime: null, endTime: null, squads: [{ id: 1, name: 'Alpha', orderIndex: 0, slots: [{ id: 1, maxSignups: 1, signups: [{ id: 1, user: { id: 42, username: 'Alice' } }] }] }] };
  mocks.session.mockResolvedValue({ user: { id: 1 } });
  mocks.db.user.findUnique.mockResolvedValue({ userPermissions: [{ permission: { key: 'system:super_admin' }, value: 1 }] });
  mocks.db.botToken.findFirst.mockResolvedValue({ id: 9 });
  mocks.db.discordIntegration.findUnique.mockImplementation(async () => ({ revision: 1, settings: { settings } }));
  mocks.db.discordAnnouncement.findUnique.mockImplementation(async () => announcement);
  mocks.db.discordAnnouncement.update.mockImplementation(async ({ data }) => Object.assign(announcement, data));
  mocks.db.orbat.findUnique.mockImplementation(async () => orbat);
  mocks.db.discordCommand.findFirst.mockResolvedValue(null);
  mocks.db.discordCommand.create.mockImplementation(async ({ data }) => ({ id: 1, status: 'pending', createdAt: new Date(), updatedAt: new Date(), ...data }));
  mocks.db.$transaction.mockImplementation(async fn => fn(mocks.db));
});
async function snapshot() { const response = await GET(request(), context()); expect(response.status).toBe(200); return (await response.json()).data; }
async function receipt(outcome = 'updated') { const data = await snapshot(); return { channelId, messageId, contentRevision: data.contentRevision, outcome }; }

describe('automatic announcement rendering', () => {
  it('restricts snapshots and receipts to authenticated bots', async () => {
    expect((await GET(request(undefined, false), context())).status).toBe(403);
    expect((await POST(request({}, false), context())).status).toBe(403);
    mocks.db.botToken.findFirst.mockResolvedValue(null);
    expect((await GET(request(), context())).status).toBe(401);
  });
  it('returns stable content revisions, public fields only, and disables all automatic mentions', async () => {
    const first = await snapshot(), second = await snapshot();
    expect(first.contentRevision).toBe(second.contentRevision);
    expect(first.contentRevision).toMatch(/^[a-f0-9]{64}$/);
    expect(first.allowedMentions).toEqual({ parse: [], users: [], roles: [], replied_user: false });
    expect(first.needsUpdate).toBe(true);
    const selection = mocks.db.orbat.findUnique.mock.calls[0][0].select;
    expect(selection.attendanceNotes).toBeUndefined();
    expect(selection.attendances).toBeUndefined();
    expect(selection.squads.select.slots.select.signups.select.user.select).toEqual({ id: true, username: true, userRank: { select: { currentRank: { select: { name: true, abbreviation: true } } } } });
    expect(mocks.db.apiAuditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'user_data.read', targetUserIds: [42] }) });
    expect((await GET(request(), context())).headers.get('cache-control')).toBe('private, no-store');
  });
  it('invalidates revisions when the roster, configuration or signup deadline changes', async () => {
    const first = await snapshot();
    orbat.squads = [];
    const second = await snapshot(); expect(second.contentRevision).not.toBe(first.contentRevision);
    settings.fullColor = '#ff0000';
    const third = await snapshot(); expect(third.contentRevision).not.toBe(second.contentRevision);
    orbat.endsAtUtc = new Date('2020-01-01T12:00:00Z');
    const closed = await snapshot(); expect(closed.content.controls).toMatchObject({ closed: true, signup: false, availability: false });
  });
  it('records a successful current revision idempotently', async () => {
    const input = await receipt();
    expect((await POST(request(input), context())).status).toBe(200);
    expect(announcement.renderedRevision).toBe(input.contentRevision);
    expect((await snapshot()).needsUpdate).toBe(false);
    expect((await POST(request(input), context())).status).toBe(200);
    expect(mocks.db.discordAnnouncement.update).toHaveBeenCalledTimes(1);
  });
  it('rejects old content and wrong message/channel receipts', async () => {
    const input = await receipt();
    for (const change of [{ messageId: '999999999999999999' }, { channelId: '999999999999999999' }, { contentRevision: 'f'.repeat(64) }]) {
      expect((await POST(request({ ...input, ...change }), context())).status).toBe(409);
    }
    expect(mocks.db.discordAnnouncement.update).toHaveBeenCalledExactlyOnceWith({ where: { orbatId: 1 }, data: { renderedRevision: null } });
  });
  it('records missing messages without replacing them and requires explicit recovery', async () => {
    const input = await receipt('missing');
    expect((await POST(request(input), context())).status).toBe(200);
    expect((await POST(request(input), context())).status).toBe(200);
    expect(mocks.db.discordAnnouncement.update).toHaveBeenCalledTimes(1);
    expect(announcement.messageId).toBe(messageId);
    expect((await snapshot()).needsUpdate).toBe(false);
    expect((await POST(request({ ...input, outcome: 'updated' }), context())).status).toBe(409);
  });
  it('rejects snapshots until published, when disabled, while a manual command runs, or after ORBAT deletion', async () => {
    announcement.messageId = null;
    expect((await GET(request(), context())).status).toBe(409);
    announcement.messageId = messageId; settings.announcementsEnabled = false;
    expect((await GET(request(), context())).status).toBe(409);
    settings.announcementsEnabled = true; mocks.db.discordCommand.findFirst.mockResolvedValue({ id: 1 });
    expect((await GET(request(), context())).status).toBe(409);
    mocks.db.discordCommand.findFirst.mockResolvedValue(null); mocks.db.orbat.findUnique.mockResolvedValue(null);
    expect((await GET(request(), context())).status).toBe(404);
  });
  it('rejects invalid IDs, queries, and receipt fields', async () => {
    expect((await GET(request(), context('bad'))).status).toBe(400);
    expect((await GET(request(undefined, true, '?unknown=1'), context())).status).toBe(400);
    for (const input of [{}, { channelId, messageId, contentRevision: 'bad', outcome: 'updated' }, { channelId, messageId, contentRevision: 'a'.repeat(64), outcome: 'created' }]) expect((await POST(request(input), context())).status).toBe(422);
  });
});

describe('explicit missing-message recovery', () => {
  const input = { requestKey: 'repost-one', action: 'repost', channelId, mention: 'none', missionText: 'Mission!' };
  it('only queues no-ping reposts for confirmed missing messages', async () => {
    expect((await publish(request(input), context())).status).toBe(409);
    announcement.missingAt = new Date();
    expect((await publish(request({ ...input, mention: 'everyone' }), context())).status).toBe(422);
    expect((await publish(request(input), context())).status).toBe(202);
    expect(mocks.db.discordCommand.create).toHaveBeenCalledWith({ data: expect.objectContaining({ kind: 'announcement.repost', payload: { orbatId: 1, channelId, mention: 'none', missionText: 'Mission!' } }) });
    expect((await publish(request({ ...input, action: 'refresh' }), context())).status).toBe(409);
  });
  it('completion preserves existing message identity except explicitly requested missing recovery', async () => {
    const command = { id: 1, kind: 'announcement.refresh', payload: { orbatId: 1, channelId }, status: 'running', generation: 1, claimedBy: 9, claimToken: 'claim', leaseUntil: new Date(Date.now() + 60000), createdAt: new Date(), updatedAt: new Date() };
    mocks.db.discordCommand.findUnique.mockImplementation(async () => command);
    mocks.db.discordCommand.update.mockImplementation(async ({ data }) => ({ ...command, ...data }));
    const input = { claimToken: 'claim', generation: 1, success: true, result: { channelId, messageId: '999999999999999999' } };
    expect((await complete(request(input), context())).status).toBe(409);
    input.result.messageId = messageId;
    expect((await complete(request(input), context())).status).toBe(200);
    command.kind = 'announcement.repost';
    expect((await complete(request(input), context())).status).toBe(409);
    announcement.missingAt = new Date();
    input.result.messageId = '999999999999999999';
    expect((await complete(request(input), context())).status).toBe(200);
    expect(announcement).toMatchObject({ messageId: '999999999999999999', missingAt: null, renderedRevision: null, lastRenderedAt: null });
  });
});
