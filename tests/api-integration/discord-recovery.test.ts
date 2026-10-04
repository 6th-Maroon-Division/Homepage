import { afterAll, beforeAll, expect, test, vi } from 'vitest';
const session = vi.hoisted(() => ({ id: null as number | null }));
vi.mock('next-auth', () => ({ getServerSession: async () => session.id === null ? null : { user: { id: session.id } } }));
vi.mock('@/app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
import { prisma } from '@/lib/prisma';
import { Prisma } from '@/generated/prisma/client';
import { defaultSettings } from '@/lib/discord/config';
import { POST as report, GET as operations } from '@/app/api/discord/operations/route';
import { POST as complete } from '@/app/api/discord/commands/[id]/complete/route';
import { GET as menus } from '@/app/api/discord/menu-messages/route';
import { GET as announcements } from '@/app/api/discord/announcements/route';
import { POST as createCase } from '@/app/api/discord/cases/route';
import { PATCH as updateCase } from '@/app/api/discord/cases/[id]/route';

const guildId = '980000000000000001', memberId = '980000000000000002', channelId = '980000000000000003', messageId = '980000000000000004';
const menuId = 'recovery-games';
const settings = { ...defaultSettings(), guildId, menus: [{ id: menuId, title: 'Games', description: '', channelId, singleChoice: false, entries: [] }] };
let admin: number, tokenId: number;
let original: Awaited<ReturnType<typeof prisma.discordIntegration.findUnique>>;
const req = (path: string, method = 'GET', body?: unknown, bot = true) => new Request(`http://localhost/api/discord/${path}`, {
  method, headers: bot ? { authorization: 'Bearer discord-recovery-integration' } : {}, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
const ctx = (id: number) => ({ params: Promise.resolve({ id: String(id) }) });
beforeAll(async () => {
  const permission = await prisma.permission.upsert({ where: { key: 'system:super_admin' }, create: { key: 'system:super_admin' }, update: {} });
  admin = (await prisma.user.create({ data: { username: 'Discord recovery admin', userPermissions: { create: { permissionId: permission.id, value: 1 } } } })).id;
  tokenId = (await prisma.botToken.create({ data: { name: 'Discord recovery integration', token: 'discord-recovery-integration' } })).id;
  session.id = admin;
  original = await prisma.discordIntegration.findUnique({ where: { id: 1 } });
  await prisma.discordIntegration.upsert({ where: { id: 1 }, create: { id: 1, revision: 1, settings: { settings } }, update: { revision: 1, settings: { settings } } });
});
afterAll(async () => {
  if (original) await prisma.discordIntegration.update({ where: { id: 1 }, data: { revision: original.revision, settings: original.settings as Prisma.InputJsonValue } });
  else await prisma.discordIntegration.delete({ where: { id: 1 } });
  await prisma.$disconnect();
});

test('operation reports persist once, replay identical input, and reject reuse with a different outcome', async () => {
  const payload = { eventId: 'integration-recovery-join', guildId, configRevision: 1, kind: 'join.roles', status: 'failed', attempts: 3, memberId, errorCode: 'missing_permission', occurredAt: new Date().toISOString() };
  const first = await report(req('operations', 'POST', payload));
  expect(first.status).toBe(201);
  const saved = (await first.json()).data;
  const replay = await report(req('operations', 'POST', payload));
  expect(replay.status).toBe(200);
  expect((await replay.json()).data.id).toBe(saved.id);
  expect((await report(req('operations', 'POST', { ...payload, attempts: 2 }))).status).toBe(409);
  expect(await prisma.discordOperation.count({ where: { eventId: payload.eventId } })).toBe(1);
  const list = await operations(req('operations?kind=join.roles&status=failed'));
  expect((await list.json()).data).toEqual(expect.arrayContaining([expect.objectContaining({ id: saved.id, errorCode: 'missing_permission' })]));
  expect(await prisma.apiAuditLog.count({ where: { action: 'discord.operation.reported', resourceId: String(saved.id) } })).toBe(1);
});

test('menu completion persists a restart-readable reference and duplicate acknowledgement stays idempotent', async () => {
  const command = await prisma.discordCommand.create({ data: { requestKey: 'integration-recovery-menu', kind: 'menu.publish', payload: { menuId }, permission: 'discord:configure', status: 'running', generation: 1, claimedBy: tokenId, claimToken: 'recovery-claim', leaseUntil: new Date(Date.now() + 300000) } });
  const acknowledgement = { claimToken: command.claimToken, generation: 1, success: true, result: { channelId, messageId } };
  expect((await complete(req('complete', 'POST', { ...acknowledgement, result: { channelId: memberId, messageId } }), ctx(command.id))).status).toBe(422);
  expect(await prisma.discordRoleMenuMessage.count({ where: { menuId } })).toBe(0);
  for (let i = 0; i < 2; i++) expect((await complete(req('complete', 'POST', acknowledgement), ctx(command.id))).status).toBe(200);
  expect(await prisma.discordRoleMenuMessage.count({ where: { menuId } })).toBe(1);
  await prisma.discordIntegration.update({ where: { id: 1 }, data: { settings: { settings: { ...settings, menus: [] } } } });
  const response = await menus(req('menu-messages'));
  expect(response.status).toBe(200);
  expect((await response.json()).data).toEqual(expect.arrayContaining([expect.objectContaining({ menuId, channelId, messageId, lastCommandId: command.id })]));
});

test('announcement inventory paginates durable references and leaves unpublished operations unpublished', async () => {
  const firstOrbat = await prisma.orbat.create({ data: { name: 'Recovery published', createdById: admin } });
  const secondOrbat = await prisma.orbat.create({ data: { name: 'Recovery queued', createdById: admin } });
  const untouched = await prisma.orbat.create({ data: { name: 'Recovery unannounced', createdById: admin } });
  const first = await prisma.discordAnnouncement.create({ data: { orbatId: firstOrbat.id, channelId, messageId, missionText: 'Preserve the mission text', mention: 'everyone' } });
  const second = await prisma.discordAnnouncement.create({ data: { orbatId: secondOrbat.id, channelId, missionText: 'Awaiting publication' } });
  const response = await announcements(req(`announcements?cursor=${first.id}&limit=1`));
  expect(response.status).toBe(200);
  expect((await response.json()).data).toEqual([expect.objectContaining({ id: second.id, orbatId: secondOrbat.id, messageId: null, missionText: 'Awaiting publication' })]);
  const previous = await announcements(req(`announcements?${first.id > 1 ? `cursor=${first.id - 1}&` : ''}limit=1`));
  const page = await previous.json();
  expect(page.data[0]).toMatchObject({ messageId, mention: 'everyone', missionText: 'Preserve the mission text' });
  expect(page.meta.nextCursor).toBe(String(first.id));
  expect(await prisma.discordAnnouncement.count({ where: { orbatId: untouched.id } })).toBe(0);
  expect((await announcements(req('announcements', 'GET', undefined, false))).status).toBe(403);
});

test('cleanup receipts after early release preserve punishment state and timestamps in the database', async () => {
  const now = new Date();
  const existing = await prisma.discordModerationCase.create({ data: { triggerId: '980000000000000099', guildId, memberId, roleIds: [], configRevision: 1, configSnapshot: { timeoutHours: 24 }, action: 'timeout', status: 'released', occurredAt: now, releasedAt: now, timeoutUntil: new Date(now.getTime() + 86400000) } });
  const cleanup = { scanned: 2, deleted: 1, failed: 1, messages: [{ messageId, status: 'inaccessible', errorCode: 'missing_permission' }] };
  expect((await updateCase(req('case', 'PATCH', { cleanup }), ctx(existing.id))).status).toBe(200);
  expect(await prisma.discordModerationCase.findUniqueOrThrow({ where: { id: existing.id } })).toMatchObject({ status: 'released', releasedAt: existing.releasedAt, timeoutUntil: existing.timeoutUntil, cleanup });
  expect((await updateCase(req('case', 'PATCH', { status: 'applied', cleanup }), ctx(existing.id))).status).toBe(409);
  expect((await updateCase(req('case', 'PATCH', { cleanup }, false), ctx(existing.id))).status).toBe(403);
});


test('a honeypot ban cancels already claimed join-role retries in the same transaction', async () => {
  await prisma.discordIntegration.update({where: {id: 1}, data: {settings: {settings: {...settings, honeypotEnabled: true}}}});
  const command = await prisma.discordCommand.create({data: {requestKey: 'recovery-join-ban', kind: 'join.retry', payload: {memberId, guildId, operationId: 1, configRevision: 1}, permission: 'discord:configure', status: 'running', claimedBy: tokenId, claimToken: 'join-claim', leaseUntil: new Date(Date.now() + 300000)}});
  expect((await createCase(req('cases', 'POST', {triggerId: '980000000000000100', guildId, memberId, roleIds: [], configRevision: 1, occurredAt: new Date().toISOString()}))).status).toBe(201);
  expect(await prisma.discordCommand.findUnique({where: {id: command.id}})).toMatchObject({status: 'cancelled', errorCode: 'honeypot_ban', claimToken: null, leaseUntil: null});
});
