import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
const session = vi.hoisted(() => ({ userId: null as number | null }));
vi.mock('next-auth', () => ({ getServerSession: async () => session.userId === null ? null : { user: { id: String(session.userId) } } }));
vi.mock('@/app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
vi.mock('@/lib/realtime/admin-catalog-events', () => ({ publishAdminCatalogEvent: vi.fn() }));
import { prisma } from '@/lib/prisma';
import { GET as list, POST as create } from '@/app/api/templates/route';
import { GET as read, PATCH as update, DELETE as remove } from '@/app/api/templates/[id]/route';
import { GET as access } from '@/app/api/templates/access/route';
import { GET as listPermissions, POST as createPermissions } from '@/app/api/permissions/templates/route';
import { PATCH as updatePermissions, DELETE as removePermissions } from '@/app/api/permissions/templates/[id]/route';
let editor: number, member: number, role: number, permission: number;
let counter = 0;
const ctx = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) });
const request = (path: string, method = 'GET', body?: unknown, token?: string) => new Request(`http://localhost/api/${path}`, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const payload = () => ({ name: `Template integration ${++counter}`, slotsJson: [{ name: 'Squad', orderIndex: 0, slots: [{ name: 'Old role name', orderIndex: 0, maxSignups: 2, squadRoleId: role }] }] });
const permissionPayload = () => ({ name: `Permission template integration ${++counter}`, permissions: [{ permissionId: permission, value: 1 }], description: 'Sensitive description not in audit' });
beforeAll(async () => {
  if (!process.env.API_INTEGRATION_DATABASE_URL || process.env.DATABASE_URL !== process.env.API_INTEGRATION_DATABASE_URL) throw new Error('Isolated Prisma integration database required.');
  const keys = ['template:create', 'template:edit', 'template:delete', 'user:manage_permissions'];
  const rows = [];
  for (const key of keys) rows.push(await prisma.permission.upsert({ where: { key }, create: { key }, update: {} }));
  permission = rows[0].id;
  editor = (await prisma.user.create({ data: { username: 'Template editor', userPermissions: { create: rows.map(row => ({ permissionId: row.id, value: 1 })) } } })).id;
  member = (await prisma.user.create({ data: { username: 'Template member' } })).id;
  role = (await prisma.squadRole.create({ data: { name: 'Template integration role', requiredTrainingIds: [], requiredRankIds: [] } })).id;
});
beforeEach(() => { session.userId = editor; });
afterAll(async () => { await prisma.$disconnect(); });

test('ORBAT template lifecycle preserves preset structure, resolves live role names, UTC dates and soft archives', async () => {
  const input = { ...payload(), startTime: '08:30', endTime: '10:00', timezone: 'Europe/Berlin', tempFrequencies: [{ frequency: '50', type: 'SR', isAdditional: false, channel: '', callsign: '' }] };
  const response = await create(request('templates', 'POST', input)); expect(response.status).toBe(201);
  const created = (await response.json()).data;
  expect(created.slotsJson[0].slots[0]).toMatchObject({ name: 'Template integration role', squadRoleId: role, maxSignups: 2 });
  expect(created.createdBy).toEqual({ id: editor, username: 'Template editor', avatarUrl: null });
  expect(created.createdAt).toMatch(/Z$/); expect(created.startTime).toBe('08:30');
  const audit = await prisma.apiAuditLog.findFirstOrThrow({ where: { correlationId: response.headers.get('X-Request-Id')! } });
  expect(audit).toMatchObject({ action: 'orbat_template.created', actorUserId: editor, resourceId: String(created.id) }); expect(JSON.stringify(audit)).not.toContain(input.name);
  expect((await read(request(`templates/${created.id}`), ctx(created.id))).status).toBe(200);
  const changed = await update(request(`templates/${created.id}`, 'PATCH', { description: 'Updated only description' }), ctx(created.id)); expect(changed.status).toBe(200);
  const row = await prisma.orbatTemplate.findUniqueOrThrow({ where: { id: created.id } }); expect(row.slotsJson).toEqual(input.slotsJson); expect(row.startTime).toBe('08:30');
  expect((await (await remove(request(`templates/${created.id}`, 'DELETE'), ctx(created.id))).json()).data).toBeNull();
  expect((await prisma.orbatTemplate.findUniqueOrThrow({ where: { id: created.id } })).isActive).toBe(false);
  const listing = (await (await list(request('templates'))).json()).data; expect(listing.some((item: { id: number }) => item.id === created.id)).toBe(false);
  expect((await read(request(`templates/${created.id}`), ctx(created.id))).status).toBe(200);
});

test('both template families reject missing refs and duplicate names without corrupting the saved template', async () => {
  const input = payload(); const first = (await (await create(request('templates', 'POST', input))).json()).data;
  expect((await create(request('templates', 'POST', input))).status).toBe(409);
  expect((await update(request(`templates/${first.id}`, 'PATCH', { frequencyIds: [2_000_000_000] }), ctx(first.id))).status).toBe(404);
  await prisma.squadRole.update({ where: { id: role }, data: { isRetired: true } });
  try { expect((await create(request('templates', 'POST', payload()))).status).toBe(409); } finally { await prisma.squadRole.update({ where: { id: role }, data: { isRetired: false } }); }
  const p = permissionPayload(); const created = await createPermissions(request('permissions/templates', 'POST', p)); expect(created.status).toBe(201); const item = (await created.json()).data;
  expect((await createPermissions(request('permissions/templates', 'POST', p))).status).toBe(409);
  const failed = await updatePermissions(request(`permissions/templates/${item.id}`, 'PATCH', { permissions: [{ permissionId: 2_000_000_000, value: 1 }] }), ctx(item.id)); expect(failed.status).toBe(404);
  expect(await prisma.permissionTemplateItem.findMany({ where: { templateId: item.id }, select: { permissionId: true, value: true } })).toEqual(p.permissions);
});

test('permission templates support partial updates, complete grant replacement and cascade deletion with atomic audit', async () => {
  const input = permissionPayload(); const response = await createPermissions(request('permissions/templates', 'POST', input)); const created = (await response.json()).data;
  expect(created.permissions).toEqual([{ permissionId: permission, value: 1, key: 'template:create' }]); expect(created.createdAt).toMatch(/Z$/);
  const renamed = await updatePermissions(request(`permissions/templates/${created.id}`, 'PATCH', { name: `${input.name} renamed` }), ctx(created.id)); expect(renamed.status).toBe(200); expect((await renamed.json()).data.permissions).toEqual(created.permissions);
  const changed = await updatePermissions(request(`permissions/templates/${created.id}`, 'PATCH', { permissions: [{ permissionId: permission, value: 2 }] }), ctx(created.id)); expect(changed.status).toBe(200);
  const audit = await prisma.apiAuditLog.findFirstOrThrow({ where: { correlationId: changed.headers.get('X-Request-Id')! } });
  expect(audit.before).toEqual({ permissions: [{ permissionId: permission, value: 1 }] }); expect(audit.after).toEqual({ permissions: [{ permissionId: permission, value: 2 }] }); expect(JSON.stringify(audit)).not.toContain(input.description);
  const removed = await removePermissions(request(`permissions/templates/${created.id}`, 'DELETE'), ctx(created.id)); expect(removed.status).toBe(200); expect((await removed.json()).data).toBeNull();
  expect(await prisma.permissionTemplateItem.count({ where: { templateId: created.id } })).toBe(0); expect(await prisma.permissionTemplate.findUnique({ where: { id: created.id } })).toBeNull();
});

test('every endpoint enforces live permissions and active bot authentication; bot templates have null creator', async () => {
  const template = (await (await create(request('templates', 'POST', payload()))).json()).data;
  const p = (await (await createPermissions(request('permissions/templates', 'POST', permissionPayload()))).json()).data;
  const calls = [() => list(request('templates')), () => read(request(`templates/${template.id}`), ctx(template.id)), () => create(request('templates', 'POST', payload())), () => update(request(`templates/${template.id}`, 'PATCH', { name: 'Denied' }), ctx(template.id)), () => remove(request(`templates/${template.id}`, 'DELETE'), ctx(template.id)), () => listPermissions(request('permissions/templates')), () => createPermissions(request('permissions/templates', 'POST', permissionPayload())), () => updatePermissions(request(`permissions/templates/${p.id}`, 'PATCH', { name: 'Denied' }), ctx(p.id)), () => removePermissions(request(`permissions/templates/${p.id}`, 'DELETE'), ctx(p.id))];
  session.userId = member; for (const call of calls) expect((await call()).status).toBe(403);
  expect((await (await access(request('templates/access'))).json()).data).toEqual({ canCreate: false, canEdit: false, canDelete: false, canRead: false });
  session.userId = null; for (const call of calls) expect((await call()).status).toBe(401); expect((await access(request('templates/access'))).status).toBe(401);
  const bot = await prisma.botToken.create({ data: { name: 'Template integration bot', token: 'template-integration-token' } });
  const response = await create(request('templates', 'POST', payload(), bot.token)); expect(response.status).toBe(201); const row = (await response.json()).data; expect(row.createdBy).toBeNull(); expect(row.createdById).toBeNull();
  const audit = await prisma.apiAuditLog.findFirstOrThrow({ where: { correlationId: response.headers.get('X-Request-Id')! } }); expect(audit.actorTokenId).toBe(bot.id);
  expect((await createPermissions(request('permissions/templates', 'POST', permissionPayload(), bot.token))).status).toBe(201);
  await prisma.botToken.update({ where: { id: bot.id }, data: { isActive: false } }); session.userId = editor;
  expect((await list(request('templates', 'GET', undefined, bot.token))).status).toBe(401);
});

test('pagination traverses both collections exactly once; creator reads only audit displayed other users', async () => {
  const created = (await (await create(request('templates', 'POST', payload()))).json()).data;
  for (const [path, handler] of [['templates', list], ['permissions/templates', listPermissions]] as const) {
    const seen = new Set<number>(); let cursor: string | null = null;
    do {
      const response: Response = await handler(request(`${path}?limit=1${cursor ? `&cursor=${cursor}` : ''}`)); expect(response.status).toBe(200);
      const page: { data: { id: number }[]; meta: { nextCursor: string | null } } = await response.json(); for (const item of page.data) { expect(seen.has(item.id)).toBe(false); seen.add(item.id); }
      cursor = page.meta.nextCursor;
    } while (cursor);
    expect(seen.size).toBeGreaterThan(0);
  }
  const own = await read(request(`templates/${created.id}`), ctx(created.id)); expect(await prisma.apiAuditLog.count({ where: { correlationId: own.headers.get('X-Request-Id')! } })).toBe(0);
  const bot = await prisma.botToken.create({ data: { name: 'Template reading bot', token: 'template-reading-token' } });
  const other = await read(request(`templates/${created.id}`, 'GET', undefined, bot.token), ctx(created.id));
  const audit = await prisma.apiAuditLog.findFirstOrThrow({ where: { correlationId: other.headers.get('X-Request-Id')! } }); expect(audit).toMatchObject({ action: 'user_data.read', targetUserIds: [editor] }); expect(audit.before).toBeNull(); expect(audit.after).toBeNull();
});

test('audit insert failure rolls back both families mutations', async () => {
  const realTransaction = prisma.$transaction.bind(prisma);
  const spy = vi.spyOn(prisma, '$transaction').mockImplementation(async (...args: unknown[]) => {
    const work = args[0] as (tx: typeof prisma) => Promise<unknown>;
    return realTransaction(async tx => work(new Proxy(tx, { get(target, key) { if (key === 'apiAuditLog') return { create: async () => { throw new Error('Forced audit failure'); } }; return Reflect.get(target, key); } }) as typeof prisma)) as never;
  });
  const input = payload(), permissions = permissionPayload();
  try { expect((await create(request('templates', 'POST', input))).status).toBe(500); expect((await createPermissions(request('permissions/templates', 'POST', permissions))).status).toBe(500); } finally { spy.mockRestore(); }
  expect(await prisma.orbatTemplate.findUnique({ where: { name: input.name } })).toBeNull(); expect(await prisma.permissionTemplate.findUnique({ where: { name: permissions.name } })).toBeNull();
});

test('permission template writes reject values above the configured catalog maximum', async () => {
  const bounded = await prisma.permission.create({ data: { key: 'templates:test_bound', maxValue: 3 } });
  const input = { name: 'Bounded integration template', permissions: [{ permissionId: bounded.id, value: 4 }] };
  const rejected = await createPermissions(request('permissions/templates', 'POST', input)); expect(rejected.status).toBe(422);
  expect(await prisma.permissionTemplate.findUnique({ where: { name: input.name } })).toBeNull();
  const allowed = await createPermissions(request('permissions/templates', 'POST', { ...input, permissions: [{ permissionId: bounded.id, value: 3 }] })); expect(allowed.status).toBe(201);
  const row = (await allowed.json()).data;
  const changed = await updatePermissions(request(`permissions/templates/${row.id}`, 'PATCH', { permissions: [{ permissionId: bounded.id, value: 255 }] }), ctx(row.id)); expect(changed.status).toBe(422);
  expect((await prisma.permissionTemplateItem.findMany({ where: { templateId: row.id } }))[0].value).toBe(3);
  expect(await prisma.apiAuditLog.count({ where: { correlationId: changed.headers.get('X-Request-Id')! } })).toBe(0);
});
