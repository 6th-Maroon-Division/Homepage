import { expect, test, vi } from 'vitest';
const session = vi.hoisted(() => ({id: null as number | null}));
vi.mock('next-auth', () => ({getServerSession: async () => session.id === null ? null : {user: {id: session.id}}}));
vi.mock('@/app/api/auth/[...nextauth]/route', () => ({authOptions: {}}));
import { prisma } from '@/lib/prisma';
import { Prisma } from '@/generated/prisma/client';
import { defaultSettings } from '@/lib/discord/config';
import { PUT, GET } from '@/app/api/discord/config/route';
import { GET as history } from '@/app/api/discord/config/history/route';
import { POST as heartbeat } from '@/app/api/discord/heartbeat/route';
const guild = '970000000000000001', role = '970000000000000002';
const request = (path: string, method = 'GET', body?: unknown, bot = false) => new Request(`http://localhost/api/discord/${path}`, {method, headers: bot ? {authorization: 'Bearer diagnostic-integration'} : {}, ...(body === undefined ? {} : {body: JSON.stringify(body)})});
test('configuration archives and bot diagnostics persist with fresh inventory enforcement', async () => {
  const permission = await prisma.permission.upsert({where: {key: 'system:super_admin'}, create: {key: 'system:super_admin'}, update: {}});
  session.id = (await prisma.user.create({data: {username: 'diagnostic integration admin', userPermissions: {create: {permissionId: permission.id, value: 1}}}})).id;
  await prisma.botToken.create({data: {name: 'diagnostic integration', token: 'diagnostic-integration'}});
  const original = await prisma.discordIntegration.findUnique({where: {id: 1}});
  const settings = {...defaultSettings(), guildId: guild, websiteUrl: 'https://unit.example'};
  try {
    await prisma.discordIntegration.upsert({where: {id: 1}, create: {id: 1, revision: 30000, settings: {settings}}, update: {revision: 30000, settings: {settings}, metadata: Prisma.DbNull, metadataObservedAt: null}});
    expect((await PUT(request('config', 'PUT', {revision: 30000, settings}))).status).toBe(200);
    expect(await prisma.discordConfigurationRevision.count({where: {revision: {in: [30000, 30001]}}})).toBe(2);
    expect((await (await history(request('config/history'))).json()).data).toEqual(expect.arrayContaining([expect.objectContaining({revision: 30001, settings})]));
    const diagnostics = {configRevision: 30001, supportedSchemaVersions: [1], pendingCount: 3, failedCount: 1, issues: [{code: 'role_hierarchy', severity: 'error', field: 'defaultRoleIds', resourceId: role}], permissions: [{capability: 'manage_roles', granted: false}]};
    const metadataObservedAt = new Date().toISOString();
    expect((await heartbeat(request('heartbeat', 'POST', {guildId: guild, appliedRevision: 30001, botVersion: 'test', health: 'degraded', diagnostics, metadataObservedAt, metadata: {roles: [{id: role, name: 'Default', manageable: false}], channels: []}}, true))).status).toBe(200);
    expect((await (await GET(request('config'))).json()).data).toMatchObject({diagnostics, metadataObservedAt});
    expect((await PUT(request('config', 'PUT', {revision: 30001, settings: {...settings, defaultRoleIds: [role]}}))).status).toBe(422);
    expect(await prisma.discordConfigurationRevision.count({where: {revision: 30002}})).toBe(0);
  } finally {
    await prisma.discordConfigurationRevision.deleteMany({where: {revision: {gte: 30000, lte: 30002}}});
    if (original) {
      const data = original;
      await prisma.discordIntegration.update({where: {id: 1}, data: {...data, settings: data.settings as Prisma.InputJsonValue, metadata: data.metadata === null ? Prisma.DbNull : data.metadata as Prisma.InputJsonValue, diagnostics: data.diagnostics === null ? Prisma.DbNull : data.diagnostics as Prisma.InputJsonValue}});
    } else await prisma.discordIntegration.delete({where: {id: 1}});
    await prisma.$disconnect();
  }
});
