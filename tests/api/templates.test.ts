import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => {
  const methods = () => ({ findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() });
  return { session: vi.fn(), publish: vi.fn(), prisma: { user: methods(), botToken: methods(), orbatTemplate: methods(), permissionTemplate: methods(), permission: methods(), squadRole: methods(), radioFrequency: methods(), apiAuditLog: methods(), $transaction: vi.fn() } };
});
vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }));
vi.mock('next-auth', () => ({ getServerSession: mocks.session }));
vi.mock('@/app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
vi.mock('@/lib/realtime/admin-catalog-events', () => ({ publishAdminCatalogEvent: mocks.publish }));
import { GET as list, POST as create } from '@/app/api/templates/route';
import { GET as read, PATCH as update, DELETE as remove } from '@/app/api/templates/[id]/route';
import { GET as access } from '@/app/api/templates/access/route';
import { GET as listPermissions, POST as createPermissions } from '@/app/api/permissions/templates/route';
import { PATCH as updatePermissions, DELETE as removePermissions } from '@/app/api/permissions/templates/[id]/route';
import { parseOrbatTemplate, orbatTemplateError } from '@/lib/api/orbat-templates';
import { parsePermissionTemplate, permissionTemplateError } from '@/lib/api/permission-templates';
const ctx = (id = '1') => ({ params: Promise.resolve({ id }) });
const input = { name: 'Template', slotsJson: [{ name: 'Squad', orderIndex: 0, slots: [{ name: 'Medic', orderIndex: 0, maxSignups: 1, squadRoleId: 3 }] }] };
const permissionInput = { name: 'Permissions', permissions: [{ permissionId: 4, value: 1 }] };
const timestamp = new Date('2026-09-18T00:00:00Z');
const template = { id: 1, ...input, frequencyIds: [], tempFrequencies: [], isActive: true, isSideOp: false, createdAt: timestamp, updatedAt: timestamp, createdById: 1, createdBy: { id: 1, username: 'Self', avatarUrl: null } };
const permissionTemplate = { id: 1, name: 'Permissions', description: null, createdAt: timestamp, updatedAt: timestamp, items: [{ permissionId: 4, value: 1, permission: { key: 'orbat:edit' } }] };
const req = (method = 'GET', body?: unknown, bot = false, query = '') => new Request(`http://localhost/api/templates${query}`, { method, headers: { 'content-type': 'application/json', ...(bot ? { authorization: 'Bearer good' } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const calls = [
  ['list', (bot = false, query = '') => list(req('GET', undefined, bot, query))],
  ['read', (bot = false, query = '') => read(req('GET', undefined, bot, query), ctx())],
  ['access', (bot = false, query = '') => access(req('GET', undefined, bot, query))],
  ['create', (bot = false, query = '') => create(req('POST', input, bot, query))],
  ['update', (bot = false, query = '') => update(req('PATCH', { name: 'Changed' }, bot, query), ctx())],
  ['delete', (bot = false, query = '') => remove(req('DELETE', undefined, bot, query), ctx())],
  ['permission list', (bot = false, query = '') => listPermissions(req('GET', undefined, bot, query))],
  ['permission create', (bot = false, query = '') => createPermissions(req('POST', permissionInput, bot, query))],
  ['permission update', (bot = false, query = '') => updatePermissions(req('PATCH', { description: 'Changed' }, bot, query), ctx())],
  ['permission delete', (bot = false, query = '') => removePermissions(req('DELETE', undefined, bot, query), ctx())],
] as const;
beforeEach(() => {
  vi.resetAllMocks(); mocks.session.mockResolvedValue({ user: { id: '1' } });
  mocks.prisma.user.findUnique.mockResolvedValue({ userPermissions: [{ permission: { key: 'system:super_admin' }, value: 255 }] });
  mocks.prisma.botToken.findFirst.mockResolvedValue({ id: 9 });
  mocks.prisma.$transaction.mockImplementation(work => work(mocks.prisma));
  mocks.prisma.orbatTemplate.findUnique.mockResolvedValue(template); mocks.prisma.orbatTemplate.findMany.mockResolvedValue([template]);
  mocks.prisma.orbatTemplate.create.mockImplementation(async ({ data }) => ({ ...template, ...data, createdBy: data.createdById === null ? null : template.createdBy }));
  mocks.prisma.orbatTemplate.update.mockImplementation(async ({ data }) => ({ ...template, ...data }));
  mocks.prisma.permissionTemplate.findUnique.mockResolvedValue(permissionTemplate); mocks.prisma.permissionTemplate.findMany.mockResolvedValue([permissionTemplate]);
  mocks.prisma.permissionTemplate.create.mockResolvedValue(permissionTemplate); mocks.prisma.permissionTemplate.update.mockResolvedValue(permissionTemplate);
  mocks.prisma.permission.findMany.mockResolvedValue([{ id: 4, maxValue: 255 }]); mocks.prisma.squadRole.findMany.mockResolvedValue([{ id: 3, name: 'Current medic', isRetired: false, requiredTrainingIds: [5], requiredRankIds: [6] }]); mocks.prisma.radioFrequency.count.mockResolvedValue(1);
});
it.each(calls)('%s supports live users and bots', async (_name, call) => { expect((await call()).status).toBeLessThan(300); expect((await call(true)).status).toBeLessThan(300); });
it.each(calls)('%s rejects absent/invalid credentials without fallback', async (_name, call) => { mocks.session.mockResolvedValue(null); expect((await call()).status).toBe(401); mocks.session.mockResolvedValue({ user: { id: '1' } }); mocks.prisma.botToken.findFirst.mockResolvedValue(null); expect((await call(true)).status).toBe(401); });
it.each(calls.filter(([name]) => name !== 'access'))('%s rejects insufficient live rights', async (_name, call) => { mocks.prisma.user.findUnique.mockResolvedValue({ userPermissions: [] }); expect((await call()).status).toBe(403); });
it.each(calls)('%s rejects unknown query parameters', async (_name, call) => { expect((await call(false, '?unknown=true')).status).toBe(400); });
it('access returns live individual capabilities without data-read audit', async () => {
  mocks.prisma.user.findUnique.mockResolvedValue({ userPermissions: [{ permission: { key: 'orbat:create' }, value: 1 }] });
  expect((await (await access(req())).json()).data).toEqual({ canRead: true, canCreate: false, canEdit: false, canDelete: false });
  expect((await list(req())).status).toBe(200); expect(mocks.prisma.apiAuditLog.create).not.toHaveBeenCalled();
});
it.each([list, listPermissions])('paginates with actual lookahead and rejects repeated/malformed cursor', async handler => {
  const model = handler === list ? mocks.prisma.orbatTemplate : mocks.prisma.permissionTemplate;
  const row = handler === list ? template : permissionTemplate;
  model.findMany.mockResolvedValue([row, { ...row, id: 2 }]);
  const data = await (await handler(req('GET', undefined, false, '?limit=1&cursor=3'))).json();
  expect(data.data).toHaveLength(1); expect(data.meta).toEqual({ limit: 1, nextCursor: '1' });
  expect(model.findMany.mock.calls[0][0]).toMatchObject({ where: { id: { gt: 3 } }, take: 2, orderBy: { id: 'asc' } });
  for (const query of ['?limit=1&limit=2', '?cursor=2147483648', '?limit=0']) expect((await handler(req('GET', undefined, false, query))).status).toBe(400);
});
it('reads current role names and prerequisites, UTC timestamps and only audits returned other creators', async () => {
  const other = { ...template, id: 2, createdBy: { ...template.createdBy, id: 2 } };
  mocks.prisma.orbatTemplate.findMany.mockResolvedValue([template, other]);
  const self = await (await list(req('GET', undefined, false, '?limit=1'))).json();
  expect(self.data[0].slotsJson[0].slots[0]).toMatchObject({ name: 'Current medic', requiredTrainingIds: [5], requiredRankIds: [6] });
  expect(self.data[0].createdAt).toBe(timestamp.toISOString()); expect(mocks.prisma.apiAuditLog.create).not.toHaveBeenCalled();
  await list(req()); expect(mocks.prisma.apiAuditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'user_data.read', targetUserIds: [2] }) });
  mocks.prisma.apiAuditLog.create.mockRejectedValue(new Error('audit down')); expect((await list(req())).status).toBe(500);
});
it('soft deletes templates, hard deletes permission templates, and audits both', async () => {
  expect((await (await remove(req('DELETE'), ctx())).json()).data).toBeNull();
  expect(mocks.prisma.orbatTemplate.update).toHaveBeenCalledWith(expect.objectContaining({ data: { isActive: false } }));
  expect((await (await removePermissions(req('DELETE'), ctx())).json()).data).toBeNull(); expect(mocks.prisma.permissionTemplate.delete).toHaveBeenCalled();
  expect(mocks.prisma.apiAuditLog.create).toHaveBeenCalledTimes(2);
});
it('validates references before writes and keeps missing/retired conflicts distinct', async () => {
  mocks.prisma.squadRole.findMany.mockResolvedValue([]); expect((await create(req('POST', input))).status).toBe(404);
  mocks.prisma.squadRole.findMany.mockResolvedValue([{ id: 3, isRetired: true }]); expect((await create(req('POST', input))).status).toBe(409);
  mocks.prisma.permission.findMany.mockResolvedValue([]); expect((await createPermissions(req('POST', permissionInput))).status).toBe(404);
  mocks.prisma.radioFrequency.count.mockResolvedValue(0); expect((await update(req('PATCH', { frequencyIds: [7] }), ctx())).status).toBe(404);
  expect(mocks.prisma.orbatTemplate.create).not.toHaveBeenCalled(); expect(mocks.prisma.permissionTemplate.create).not.toHaveBeenCalled();
});
it.each(['0', 'bad', '2147483648'])('validates item IDs %s', async id => {
  for (const handler of [read, update, remove, updatePermissions, removePermissions]) expect((await handler(req('PATCH', { name: 'X' }), ctx(id))).status).toBe(400);
});
it('returns 404 for missing rows', async () => { mocks.prisma.orbatTemplate.findUnique.mockResolvedValue(null); mocks.prisma.permissionTemplate.findUnique.mockResolvedValue(null); for (const handler of [read, update, remove, updatePermissions, removePermissions]) expect((await handler(req('PATCH', { name: 'X' }), ctx())).status).toBe(404); });
it('malformed mutation JSON returns 400', async () => { for (const handler of [create, createPermissions]) expect((await handler(new Request('http://localhost/api/templates', { method: 'POST', body: '{' }))).status).toBe(400); });
it.each([null, [], {}, { name: '' }, { name: 'X', unknown: true }, { slotsJson: null }, { frequencyIds: [1,1] }, { frequencyIds: ['1'] }, { tempFrequencies: [{ frequency: '1', type: 'SR', isAdditional: true }] }, { isSideOp: 1 }, { isActive: null }, { startTime: '24:00' }, { endTime: 123 }, { description: {} }, { slotsJson: [{ name: 'X', orderIndex: 0, slots: [{ name: 'X', orderIndex: 0, maxSignups: 0 }] }] }])('rejects invalid ORBAT template %j', body => { expect(parseOrbatTemplate(body, false).error?.status).toBe(422); });
it('normalizes valid template partial fields and clock defaults', () => {
  expect(parseOrbatTemplate({ name: ' X ', description: ' ', startTime: '08:00', endTime: null, isActive: false }, false).data).toEqual({ name: 'X', description: null, startTime: '08:00', endTime: null, isActive: false });
  expect(parseOrbatTemplate(input, true).data).toMatchObject({ name: 'Template', frequencyIds: [], tempFrequencies: [] });
  expect(parseOrbatTemplate({ ...input, isActive: true }, true).error?.status).toBe(422);
});
it.each([null, [], {}, { name: 2 }, { overwrite: true }, { permissions: [] }, { permissions: [{ permissionId: 4, value: 0 }] }, { permissions: [{ permissionId: '4', value: 1 }] }, { permissions: [{ permissionId: 4, value: -1 }] }, { permissions: [{ permissionId: 4, value: 1.5 }] }, { permissions: [{ permissionId: 4, value: 1 }, { permissionId: 4, value: 2 }] }, { permissions: [null] }, { description: false }])('rejects invalid permission template %j', body => { expect(parsePermissionTemplate(body, false).error?.status).toBe(422); });
it('supports partial permission templates and excludes zero grants only after reference checks', async () => {
  expect(parsePermissionTemplate({ description: ' ' }, false).data).toEqual({ description: null });
  mocks.prisma.permission.findMany.mockResolvedValue([{ id: 4, maxValue: 255 }, { id: 5, maxValue: 255 }]);
  await createPermissions(req('POST', { name: 'New', permissions: [{ permissionId: 4, value: 1 }, { permissionId: 5, value: 0 }] }));
  expect(mocks.prisma.permissionTemplate.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ items: { create: [{ permissionId: 4, value: 1 }] } }) }));
});
it('bot creator is null, transactional audit failure aborts response and postcommit errors do not', async () => {
  const response = await create(req('POST', input, true)); expect((await response.json()).data.createdBy).toBeNull();
  mocks.publish.mockImplementation(() => { throw new Error('notification down'); }); expect((await create(req('POST', input))).status).toBe(201);
  mocks.prisma.apiAuditLog.create.mockRejectedValue(new Error('audit down')); expect((await create(req('POST', input))).status).toBe(500);
});
it.each([orbatTemplateError, permissionTemplateError])('maps missing and conflict errors and rethrows unexpected failures', fn => { expect(fn({ code: 'P2025' }).status).toBe(404); for (const code of ['P2002', 'P2003', 'P2034']) expect(fn({ code }).status).toBe(409); expect(() => fn(new Error('down'))).toThrow('down'); });

it('projects legacy preset JSON without copied personal records or old aliases', async () => {
  mocks.prisma.orbatTemplate.findUnique.mockResolvedValue({ ...template, slotsJson: [{ id: 55, name: 'Legacy', orderIndex: 0, subslots: [{ id: 66, name: 'Old', orderIndex: 0, maxSignups: 1, squadRoleId: 3, requiredTrainingId: 99, signups: [{ user: { email: 'private@example.test' } }] }] }], tempFrequencies: [{ _id: 'client-only', frequency: '50', type: 'SR', isAdditional: false, extra: 'discard' }] });
  const data = (await (await read(req(), ctx())).json()).data;
  expect(data.slotsJson).toEqual([{ name: 'Legacy', orderIndex: 0, slots: [{ name: 'Current medic', orderIndex: 0, maxSignups: 1, squadRoleId: 3, requiredTrainingIds: [5], requiredRankIds: [6] }] }]);
  expect(data.tempFrequencies).toEqual([{ frequency: '50', type: 'SR', isAdditional: false, channel: '', callsign: '' }]);
  expect(JSON.stringify(data)).not.toContain('private@example.test');
});

it('permission templates respect catalog-specific grant ceilings before writing', async () => {
  mocks.prisma.permission.findMany.mockResolvedValue([{ id: 4, maxValue: 3 }]);
  expect((await createPermissions(req('POST', { name: 'Too high', permissions: [{ permissionId: 4, value: 4 }] }))).status).toBe(422);
  expect((await updatePermissions(req('PATCH', { permissions: [{ permissionId: 4, value: 255 }] }), ctx())).status).toBe(422);
  expect(mocks.prisma.permissionTemplate.create).not.toHaveBeenCalled(); expect(mocks.prisma.permissionTemplate.update).not.toHaveBeenCalled();
  expect(mocks.prisma.apiAuditLog.create).not.toHaveBeenCalled();
  expect((await createPermissions(req('POST', { name: 'At bound', permissions: [{ permissionId: 4, value: 3 }] }))).status).toBe(201);
});
