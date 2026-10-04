import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  db: {
    user: { findUnique: vi.fn() },
    botToken: { findFirst: vi.fn(), update: vi.fn() },
    discordAnnouncement: { findMany: vi.fn() },
    apiAuditLog: { create: vi.fn() },
  },
}));
vi.mock('@/lib/prisma', () => ({ prisma: mocks.db }));
vi.mock('next-auth', () => ({ getServerSession: mocks.session }));
vi.mock('@/app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));

import { GET } from '@/app/api/discord/announcements/route';

const request = (query = '', bot = true) => new Request(`http://localhost/api/discord/announcements${query}`, { headers: bot ? { authorization: 'Bearer token' } : {} });
const row = (id: number, messageId: string | null = '123456789012345678') => ({ id, orbatId: id + 10, channelId: '234567890123456789', mention: 'none', missionText: 'Mission briefing', messageId, updatedAt: new Date('2026-10-04T12:00:00Z') });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ user: { id: 1 } });
  mocks.db.user.findUnique.mockResolvedValue({ userPermissions: [{ permission: { key: 'system:super_admin' }, value: 255 }] });
  mocks.db.botToken.findFirst.mockResolvedValue({ id: 9 });
  mocks.db.discordAnnouncement.findMany.mockResolvedValue([]);
});

describe('bot announcement reconciliation index', () => {
  it('rejects unauthenticated, revoked-token, and even superadmin session requests', async () => {
    expect((await GET(request('', false))).status).toBe(403);
    mocks.session.mockResolvedValue(null);
    expect((await GET(request('', false))).status).toBe(401);
    mocks.db.botToken.findFirst.mockResolvedValue(null);
    expect((await GET(request())).status).toBe(401);
    expect(mocks.db.discordAnnouncement.findMany).not.toHaveBeenCalled();
  });

  it('returns published and pending announcements with stable message mappings', async () => {
    const rows = [row(1), row(2, null)];
    mocks.db.discordAnnouncement.findMany.mockResolvedValue(rows);
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toEqual({ data: JSON.parse(JSON.stringify(rows)), meta: { limit: 30, nextCursor: null } });
    expect(mocks.db.discordAnnouncement.findMany).toHaveBeenCalledWith({
      where: {}, orderBy: { id: 'asc' }, take: 31,
      select: { id: true, orbatId: true, channelId: true, mention: true, missionText: true, messageId: true, updatedAt: true, renderedRevision: true, lastRenderedAt: true, missingAt: true },
    });
  });

  it('returns ascending cursor pages without exposing the lookahead row', async () => {
    mocks.db.discordAnnouncement.findMany.mockResolvedValue([row(4), row(8), row(12)]);
    const response = await GET(request('?cursor=3&limit=2'));
    const result = await response.json();
    expect(result.data.map((item: { id: number }) => item.id)).toEqual([4, 8]);
    expect(result.meta).toEqual({ nextCursor: '8', limit: 2 });
    expect(mocks.db.discordAnnouncement.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { gt: 3 } }, orderBy: { id: 'asc' }, take: 3 }));
  });

  it('returns an empty final page', async () => {
    expect(await (await GET(request('?cursor=99'))).json()).toEqual({ data: [], meta: { nextCursor: null, limit: 30 } });
  });

  it('caps large page sizes at the shared maximum', async () => {
    const result = await (await GET(request('?limit=101'))).json();
    expect(result.meta.limit).toBe(100);
    expect(mocks.db.discordAnnouncement.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 101 }));
  });

  it.each(['?unknown=1', '?limit=0', '?cursor=invalid', '?cursor=-1', '?limit=1&limit=2'])('rejects invalid pagination %s', async query => {
    expect((await GET(request(query))).status).toBe(400);
    expect(mocks.db.discordAnnouncement.findMany).not.toHaveBeenCalled();
  });
});
