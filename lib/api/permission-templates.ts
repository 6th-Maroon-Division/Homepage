import type { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import { handleApiRequest } from './handler';
import { readJsonBody } from './request';
import { apiError, apiSuccess } from './response';
import { parseCursorPagination, parsePositiveId } from './validation';
import { writeApiAudit } from './audit';

const include = { items: { include: { permission: { select: { key: true } } }, orderBy: { permissionId: 'asc' as const } } };
type Template = Prisma.PermissionTemplateGetPayload<{ include: typeof include }>;
const dto = (row: Template) => ({ id: row.id, name: row.name, description: row.description, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), permissions: row.items.map(item => ({ permissionId: item.permissionId, key: item.permission.key, value: item.value })) });
const snapshot = (row: Template) => ({ permissions: row.items.map(({ permissionId, value }) => ({ permissionId, value })) });
type Input = { name?: string; description?: string | null; permissions?: { permissionId: number; value: number }[] };
export function parsePermissionTemplate(body: unknown, creating: boolean): { data: Input; error?: never } | { error: Response; data?: never } {
  const invalid = () => ({ error: apiError(422, 'validation_failed', 'Provide a template name and unique permissions with non-negative integer values; PATCH accepts a nonempty partial update.') });
  if (!body || typeof body !== 'object' || Array.isArray(body)) return invalid();
  const input = body as Record<string, unknown>;
  if (!Object.keys(input).length || Object.keys(input).some(key => !['name', 'description', 'permissions'].includes(key))) return invalid();
  const data: Input = {};
  if (creating || 'name' in input) { if (typeof input.name !== 'string' || !input.name.trim()) return invalid(); data.name = input.name.trim(); }
  if ('description' in input) { if (input.description !== null && typeof input.description !== 'string') return invalid(); data.description = typeof input.description === 'string' ? input.description.trim() || null : null; }
  if (creating || 'permissions' in input) {
    if (!Array.isArray(input.permissions)) return invalid();
    const entries: NonNullable<Input['permissions']> = [];
    const ids = new Set<number>();
    for (const entry of input.permissions) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry) || Object.keys(entry).some(key => !['permissionId', 'value'].includes(key))) return invalid();
      const { permissionId, value } = entry;
      if (typeof permissionId !== 'number' || !Number.isInteger(permissionId) || permissionId <= 0 || permissionId > 2147483647 || ids.has(permissionId) || typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 2147483647) return invalid();
      ids.add(permissionId); entries.push({ permissionId, value });
    }
    if (!entries.some(entry => entry.value > 0)) return invalid();
    data.permissions = entries;
  }
  return { data };
}
export function permissionTemplateError(error: unknown): Response {
  const code = (error as { code?: string })?.code;
  if (code === 'P2025') return apiError(404, 'not_found', 'Permission template not found.');
  if (['P2002', 'P2003', 'P2034'].includes(code ?? '')) return apiError(409, 'conflict', 'Template name already exists or the template changed concurrently. Reload and retry.');
  throw error;
}
export function permissionTemplateRequest(request: Request, operation: 'list' | 'create' | 'update' | 'delete', rawId?: string) {
  return handleApiRequest(request, 'user:manage_permissions', async (_principal, audit) => {
    const query = new URL(request.url).searchParams;
    if ([...query.keys()].some(key => operation !== 'list' || !['limit', 'cursor'].includes(key) || query.getAll(key).length !== 1)) return apiError(400, 'invalid_request', 'Unexpected or repeated query parameter.');
    if (operation === 'list') {
      const paging = parseCursorPagination(query, { defaultLimit: 50, maxLimit: 100 });
      if (paging.error) return apiError(400, 'invalid_request', paging.error);
      const { limit, cursor } = paging.data!;
      const rows = await prisma.permissionTemplate.findMany({ where: cursor ? { id: { gt: cursor } } : {}, orderBy: { id: 'asc' }, take: limit + 1, include });
      return apiSuccess(rows.slice(0, limit).map(dto), { meta: { limit, nextCursor: rows.length > limit ? String(rows[limit - 1].id) : null } });
    }
    const id = rawId === undefined ? null : parsePositiveId(rawId);
    if (operation !== 'create' && (id === null || id > 2147483647)) return apiError(400, 'invalid_request', 'Invalid template ID.');
    const parsed = operation === 'delete' ? { data: {} as Input } : parsePermissionTemplate(await readJsonBody(request), operation === 'create');
    if (parsed.error) return parsed.error;
    const input = parsed.data!;
    try {
      return await prisma.$transaction(async tx => {
        const before = id === null ? null : await tx.permissionTemplate.findUnique({ where: { id }, include });
        if (id !== null && !before) return apiError(404, 'not_found', 'Permission template not found.');
        if (input.permissions) {
          const refs = await tx.permission.findMany({ where: { id: { in: input.permissions.map(item => item.permissionId) } }, select: { id: true, maxValue: true } });
          if (refs.length !== input.permissions.length) return apiError(404, 'not_found', 'One or more permissions do not exist.');
          if (input.permissions.some(entry => entry.value > refs.find(ref => ref.id === entry.permissionId)!.maxValue)) return apiError(422, 'validation_failed', 'Permission values must not exceed their configured maximum.');
        }
        if (operation === 'delete') {
          await tx.permissionTemplate.delete({ where: { id: id! } });
          await writeApiAudit(tx, audit, { action: 'permission_template.deleted', resource: 'permission_template', resourceId: String(id), outcome: 'success', before: snapshot(before!) });
          return apiSuccess(null);
        }
        const { permissions, ...fields } = input;
        const items = permissions?.filter(item => item.value > 0);
        const row = operation === 'create'
          ? await tx.permissionTemplate.create({ data: { name: input.name!, description: input.description, items: { create: items } }, include })
          : await tx.permissionTemplate.update({ where: { id: id! }, data: { ...fields, ...(items ? { items: { deleteMany: {}, create: items } } : {}) }, include });
        await writeApiAudit(tx, audit, { action: `permission_template.${operation === 'create' ? 'created' : 'updated'}`, resource: 'permission_template', resourceId: String(row.id), outcome: 'success', ...(before ? { before: snapshot(before) } : {}), after: snapshot(row) });
        return apiSuccess(dto(row), { status: operation === 'create' ? 201 : 200 });
      }, { isolationLevel: 'Serializable' });
    } catch (error) { return permissionTemplateError(error); }
  });
}
