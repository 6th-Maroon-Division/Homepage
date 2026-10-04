import { afterAll, expect, test, vi } from 'vitest';
vi.mock('next-auth', () => ({ getServerSession: async () => null }));
vi.mock('@/app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
import { prisma } from '@/lib/prisma';
import type { Prisma } from '@/generated/prisma/client';
import { defaultSettings } from '@/lib/discord/config';
import { GET, POST } from '@/app/api/discord/announcements/[id]/render/route';
const channelId = '891234567890123456', messageId = '892345678901234567';
const context = (id: number) => ({ params: Promise.resolve({ id: String(id) }) });
const request = (input?: unknown) => new Request('http://localhost/api/discord/announcements/1/render', { method: input === undefined ? 'GET' : 'POST', headers: { authorization: 'Bearer announcement-render-integration' }, ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
let original: Awaited<ReturnType<typeof prisma.discordIntegration.findUnique>>;
let changedConfiguration = false;
afterAll(async () => {
  if (changedConfiguration) {
    if (original) await prisma.discordIntegration.update({ where: { id: 1 }, data: { revision: original.revision, settings: original.settings as Prisma.InputJsonValue, updatedAt: original.updatedAt } });
    else await prisma.discordIntegration.delete({ where: { id: 1 } });
  }
  await prisma.$disconnect();
});
test('real snapshots exclude absence secrets, track roster mutations, reject stale edits, and recover missing messages explicitly', async () => {
  await prisma.botToken.create({ data: { name: 'Announcement rendering', token: 'announcement-render-integration' } });
  const user = await prisma.user.create({ data: { username: 'Public render name', email: 'private-render@example.test' } });
  const orbat = await prisma.orbat.create({ data: { name: 'Render integration', squads: { create: { name: 'Alpha', orderIndex: 0 } } }, include: { squads: true } });
  const slot = await prisma.slot.create({ data: { squadId: orbat.squads[0].id, orbatId: orbat.id, orderIndex: 0, maxSignups: 2 } });
  await prisma.signup.create({ data: { slotId: slot.id, userId: user.id } });
  await prisma.orbatAttendanceNote.create({ data: { orbatId: orbat.id, userId: user.id, status: 'unsure', reason: 'PRIVATE ABSENCE REASON' } });
  const settings = { ...defaultSettings(), announcementsEnabled: true, websiteUrl: 'https://unit.example', guildId: '893456789012345678' };
  original = await prisma.discordIntegration.findUnique({ where: { id: 1 } });
  await prisma.discordIntegration.upsert({ where: { id: 1 }, create: { id: 1, revision: 1, settings: { settings } }, update: { revision: 1, settings: { settings } } });
  changedConfiguration = true;
  await prisma.discordAnnouncement.create({ data: { orbatId: orbat.id, channelId, messageId, missionText: 'Render test' } });
  const firstResponse = await GET(request(), context(orbat.id)); expect(firstResponse.status).toBe(200);
  const first = (await firstResponse.json()).data;
  expect(JSON.stringify(first)).not.toContain('PRIVATE ABSENCE REASON'); expect(JSON.stringify(first)).not.toContain(user.email);
  expect(first.content.orbat.squads[0].slots[0].signups[0].user.username).toBe(user.username);
  const receipt = { channelId, messageId, contentRevision: first.contentRevision, outcome: 'updated' };
  expect((await POST(request(receipt), context(orbat.id))).status).toBe(200);
  await prisma.signup.deleteMany({ where: { slotId: slot.id } });
  const second = (await (await GET(request(), context(orbat.id))).json()).data;
  expect(second.contentRevision).not.toBe(first.contentRevision); expect(second.needsUpdate).toBe(true);
  expect((await POST(request({ ...receipt, contentRevision: second.contentRevision }), context(orbat.id))).status).toBe(200);
  expect((await POST(request(receipt), context(orbat.id))).status).toBe(409);
  expect((await prisma.discordAnnouncement.findUniqueOrThrow({ where: { orbatId: orbat.id } })).renderedRevision).toBeNull();
  expect((await POST(request({ ...receipt, contentRevision: second.contentRevision, outcome: 'missing' }), context(orbat.id))).status).toBe(200);
  const missing = (await (await GET(request(), context(orbat.id))).json()).data;
  expect(missing.needsUpdate).toBe(false); expect(missing.missingAt).not.toBeNull();
  expect((await POST(request({ ...receipt, contentRevision: second.contentRevision }), context(orbat.id))).status).toBe(409);
  expect(await prisma.discordCommand.count({ where: { kind: { startsWith: 'announcement.' }, payload: { path: ['orbatId'], equals: orbat.id } } })).toBe(0);
});
