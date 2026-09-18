import { prisma } from '@/lib/prisma';
import { PERMISSIONS, type PermissionKey } from '@/lib/permissions';
import { publishUserProfileEvent } from '@/lib/realtime/user-events';
import { canAccessApiUser } from './auth';
import { writeApiAudit } from './audit';
import { handleApiRequest } from './handler';
import { readJsonBody } from './request';
import { apiError, apiSuccess } from './response';
import { parsePositiveId, parseCursorPagination } from './validation';
type PermissionUpdate = { permissionId: number; value: number };
export function parseUserPermissionUpdate(body: unknown): PermissionUpdate[] | null {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => key !== 'permissions') || !('permissions' in body) || !Array.isArray(body.permissions) || !body.permissions.length) return null;
  const seen = new Set<number>();
  for (const entry of body.permissions) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || Object.keys(entry).some(key => !['permissionId', 'value'].includes(key)) || typeof entry.permissionId !== 'number' || !Number.isInteger(entry.permissionId) || entry.permissionId < 1 || entry.permissionId > 2147483647 || seen.has(entry.permissionId) || typeof entry.value !== 'number' || !Number.isInteger(entry.value) || entry.value < 0 || entry.value > 255) return null;
    seen.add(entry.permissionId);
  }
  return body.permissions as PermissionUpdate[];
}
export async function userPermissions(request: Request, idValue: string, method: 'GET' | 'PATCH') {
  return handleApiRequest(request, 'user:manage_permissions', async (principal, context) => {
    const userId = idValue === 'me' && principal.kind === 'user' ? principal.userId : parsePositiveId(idValue);
    if (!userId || userId > 2147483647 || new URL(request.url).searchParams.size) return apiError(400, 'invalid_request', 'Use a positive Int32 user id or session-only me without query parameters.');
    let updates: PermissionUpdate[] | null = null;
    if (method === 'PATCH') {
      if (principal.kind === 'user' && principal.userId === userId) return apiError(403, 'forbidden', 'You cannot modify your own permissions.');
      updates = parseUserPermissionUpdate(await readJsonBody(request));
      if (!updates) return apiError(422, 'validation_failed', 'Use nonempty unique numeric permissionId/value entries; values must be integers from 0 to 255.');
    }
    try {
      const result = await prisma.$transaction(async tx => {
        const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true, username: true } });
        if (!user) return { error: apiError(404, 'not_found', 'User not found.') };
        if (!(await canAccessApiUser(principal, userId, 'user:manage_permissions', tx))) return { error: apiError(403, 'forbidden', 'You cannot manage this user’s permissions.') };
        const catalog = await tx.permission.findMany({ ...(updates ? { where: { id: { in: updates.map(entry => entry.permissionId) } } } : {}), orderBy: { key: 'asc' }, select: { id: true, key: true, description: true, defaultValue: true, maxValue: true } });
        const existing = await tx.userPermission.findMany({ where: { userId }, select: { permissionId: true, value: true } });
        const values = new Map(existing.map(entry => [entry.permissionId, entry.value]));
        if (!updates) {
          if (principal.kind === 'bot' || principal.userId !== userId) await writeApiAudit(tx, context, { action: 'user_data.read', resource: 'user_permissions', resourceId: String(userId), targetUserIds: [userId], outcome: 'success' });
          return { data: { user, permissions: catalog.map(permission => ({ ...permission, currentValue: values.get(permission.id) ?? 0 })) }, changed: false };
        }
        if (catalog.length !== updates.length) return { error: apiError(404, 'not_found', 'A permission reference does not exist.') };
        const isSuperAdmin = (principal.permissions['system:super_admin'] ?? 0) > 0;
        for (const entry of updates) {
          const permission = catalog.find(permission => permission.id === entry.permissionId)!;
          if (entry.value > permission.maxValue || !Object.hasOwn(PERMISSIONS, permission.key)) return { error: apiError(422, 'validation_failed', 'A permission is unsupported or its value exceeds the configured maximum.') };
          const oldValue = values.get(entry.permissionId) ?? 0;
          if (oldValue === entry.value) continue;
          if (!isSuperAdmin && (permission.key === 'system:super_admin' || Math.max(oldValue, entry.value) >= (principal.permissions[permission.key as PermissionKey] ?? 0))) return { error: apiError(403, 'forbidden', 'You may only modify grants strictly below your own corresponding permission level; superadmin grants require superadmin.') };
        }
        const changes = updates.filter(entry => (values.get(entry.permissionId) ?? 0) !== entry.value);
        for (const entry of changes) {
          const oldValue = values.get(entry.permissionId) ?? 0;
          await tx.permissionAuditLog.create({ data: { actorId: principal.kind === 'user' ? principal.userId : null, targetUserId: userId, permissionId: entry.permissionId, action: oldValue === 0 ? 'GRANT' : entry.value === 0 ? 'REVOKE' : 'MODIFY', oldValue: oldValue || null, newValue: entry.value || null, metadata: principal.kind === 'bot' ? { actorType: 'bot', actorTokenId: principal.tokenId } : { actorType: 'user' } } });
          if (entry.value === 0) await tx.userPermission.deleteMany({ where: { userId, permissionId: entry.permissionId } });
          else await tx.userPermission.upsert({ where: { userId_permissionId: { userId, permissionId: entry.permissionId } }, update: { value: entry.value }, create: { userId, permissionId: entry.permissionId, value: entry.value } });
        }
        if (changes.length) await writeApiAudit(tx, context, { action: 'user_permissions.updated', resource: 'user_permissions', resourceId: String(userId), targetUserIds: [userId], outcome: 'success', before: { permissions: changes.map(entry => ({ permissionId: entry.permissionId, value: values.get(entry.permissionId) ?? 0 })) }, after: { permissions: changes } });
        return { data: null, changed: changes.length > 0 };
      }, { isolationLevel: 'Serializable' });
      if (result.error) return result.error;
      if (result.changed) try { publishUserProfileEvent(userId, { source: 'permissions.updated' }); } catch { console.error('Permission notification failed', { correlationId: context.correlationId, timestamp: new Date().toISOString() }); }
      return apiSuccess(result.data);
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error) {
        if (error.code === 'P2025') return apiError(404, 'not_found', 'A permission reference no longer exists.');
        if (['P2002', 'P2003', 'P2034'].includes(String(error.code))) return apiError(409, 'conflict', 'Permissions changed concurrently. Reload and retry.');
      }
      throw error;
    }
  });
}
export async function userPermissionAudit(request: Request, idValue: string) {
  return handleApiRequest(request, 'user:manage_permissions', async (principal, context) => {
    const userId = idValue === 'me' && principal.kind === 'user' ? principal.userId : parsePositiveId(idValue);
    const params = new URL(request.url).searchParams;
    if (!userId || userId > 2147483647 || [...params.keys()].some(key => !['limit', 'cursor', 'action'].includes(key) || params.getAll(key).length !== 1)) return apiError(400, 'invalid_request', 'Use a positive Int32 user id and only limit, cursor, action query parameters.');
    const action = params.get('action');
    if (action !== null && !['GRANT', 'REVOKE', 'MODIFY'].includes(action)) return apiError(400, 'invalid_request', 'action must be GRANT, REVOKE or MODIFY.');
    const pagination = parseCursorPagination(params, { defaultLimit: 50, maxLimit: 100 });
    if (pagination.error !== undefined) return apiError(400, 'invalid_request', pagination.error);
    if (!(await prisma.user.findUnique({ where: { id: userId }, select: { id: true } }))) return apiError(404, 'not_found', 'User not found.');
    if (!(await canAccessApiUser(principal, userId, 'user:manage_permissions'))) return apiError(403, 'forbidden', 'You cannot read this user’s permission history.');
    const { limit, cursor } = pagination.data;
    const rows = await prisma.permissionAuditLog.findMany({ where: { targetUserId: userId, ...(cursor ? { id: { lt: cursor } } : {}), ...(action ? { action: action as 'GRANT' | 'REVOKE' | 'MODIFY' } : {}) }, orderBy: { id: 'desc' }, take: limit + 1, select: { id: true, action: true, oldValue: true, newValue: true, reason: true, createdAt: true, metadata: true, actor: { select: { id: true, username: true } }, permission: { select: { key: true, description: true } } } });
    const data = rows.slice(0, limit).map(({ metadata, ...row }) => ({ ...row, createdAt: row.createdAt.toISOString(), actorType: row.actor ? 'user' : metadata && typeof metadata === 'object' && !Array.isArray(metadata) && metadata.actorType === 'bot' ? 'bot' : 'deleted_user' }));
    const targetUserIds = [...new Set([userId, ...data.flatMap(row => row.actor ? [row.actor.id] : [])].filter(id => principal.kind === 'bot' || id !== principal.userId))];
    if (targetUserIds.length) await writeApiAudit(prisma, context, { action: 'user_data.read', resource: 'permission_audit', resourceId: String(userId), targetUserIds, outcome: 'success' });
    return apiSuccess(data, { meta: { limit, nextCursor: rows.length > limit ? String(data.at(-1)!.id) : null } });
  });
}
