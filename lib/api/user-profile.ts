import { prisma } from '@/lib/prisma';
import { handleApiRequest } from './handler';
import { canAccessApiUser } from './auth';
import { hasApiPermission } from './permissions';
import { apiError, apiSuccess } from './response';
import { readJsonBody } from './request';
import { parsePositiveId } from './validation';
import { writeApiAudit } from './audit';
import { publishUserProfileEvent } from '@/lib/realtime/user-events';
const select = { id: true, username: true, email: true, avatarUrl: true, createdAt: true, accounts: { orderBy: { id: 'asc' as const }, select: { provider: true } } } as const;
type ProfileUpdate = { username?: string; email?: string | null; avatarUrl?: string | null };
export function parseProfileUpdate(body: unknown): ProfileUpdate | null {
  if (!body || typeof body !== 'object' || Array.isArray(body) || !Object.keys(body).length || Object.keys(body).some(key => !['username', 'email', 'avatarUrl'].includes(key))) return null;
  const input = body as Record<string, unknown>; const result: ProfileUpdate = {};
  if ('username' in input) {
    if (typeof input.username !== 'string' || !input.username.trim() || input.username.trim().length > 50) return null;
    result.username = input.username.trim();
  }
  if ('email' in input) {
    if (input.email !== null && (typeof input.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim()))) return null;
    result.email = typeof input.email === 'string' ? input.email.trim() : null;
  }
  if ('avatarUrl' in input) {
    if (input.avatarUrl !== null && typeof input.avatarUrl !== 'string') return null;
    const url = typeof input.avatarUrl === 'string' ? input.avatarUrl.trim() : null;
    if (url) {
      if (url.startsWith('/')) { if (url.startsWith('//') || url.includes('\\')) return null; }
      else { try { if (!['http:', 'https:'].includes(new URL(url).protocol)) return null; } catch { return null; } }
    }
    result.avatarUrl = url || null;
  }
  return result;
}
export async function userProfile(request: Request, idValue: string, method: 'GET' | 'PATCH' | 'DELETE') {
  return handleApiRequest(request, undefined, async (principal, context) => {
    const id = idValue === 'me' && principal.kind === 'user' ? principal.userId : parsePositiveId(idValue);
    if (!id || id > 2147483647 || new URL(request.url).searchParams.size) return apiError(400, 'invalid_request', 'Use a positive Int32 user id (or session-only me) without query parameters.');
    if (method === 'DELETE' && (!hasApiPermission(principal.permissions, 'user:manage') || principal.kind === 'user' && principal.userId === id)) return apiError(403, 'forbidden', 'Deleting users requires user:manage and cannot target yourself.');
    let update: ProfileUpdate | null = null;
    if (method === 'PATCH') {
      update = parseProfileUpdate(await readJsonBody(request));
      if (!update) return apiError(422, 'validation_failed', 'Use username (1–50 characters), email (address or null), or avatarUrl (HTTP(S)/local path or null).');
    }
    try {
      const result = await prisma.$transaction(async tx => {
        if (!(await canAccessApiUser(principal, id, 'user:manage', tx))) return { error: apiError(403, 'forbidden', 'You cannot access this user.') };
        const before = await tx.user.findUnique({ where: { id }, select });
        if (!before) return { error: apiError(404, 'not_found', 'User not found.') };
        if (method === 'GET') {
          if (principal.kind !== 'user' || principal.userId !== id) await writeApiAudit(tx, context, { action: 'user.read', resource: 'user', resourceId: String(id), targetUserIds: [id], outcome: 'success' });
          return { data: before };
        }
        if (method === 'DELETE') {
          const references = await tx.trainingRequest.count({ where: { OR: [{ userId: id }, { handledByAdminId: id }, { assignedTrainerId: id }] } });
          const messages = await tx.trainingRequestMessage.count({ where: { senderId: id } });
          if (references || messages) return { error: apiError(409, 'conflict', 'This user has training audit records. Merge the account instead.') };
          await tx.user.delete({ where: { id } });
          await writeApiAudit(tx, context, { action: 'user.deleted', resource: 'user', resourceId: String(id), targetUserIds: [id], outcome: 'success', before: { id, username: before.username }, after: { deleted: true } });
          return { data: null };
        }
        const after = await tx.user.update({ where: { id }, data: update!, select });
        await writeApiAudit(tx, context, { action: 'user.updated', resource: 'user', resourceId: String(id), targetUserIds: [id], outcome: 'success', before: { username: before.username, email: before.email, avatarUrl: before.avatarUrl }, after: { username: after.username, email: after.email, avatarUrl: after.avatarUrl } });
        return { data: after };
      }, { isolationLevel: 'Serializable' });
      if (result.error) return result.error;
      if (method !== 'GET') { try { publishUserProfileEvent(id, { source: method === 'DELETE' ? 'user.deleted' : 'user.updated' }); } catch { console.error('User notification failed', { correlationId: context.correlationId, timestamp: new Date().toISOString() }); } }
      const row = result.data;
      return apiSuccess(row ? { id: row.id, username: row.username, email: row.email, avatarUrl: row.avatarUrl, createdAt: row.createdAt.toISOString(), providers: row.accounts.map(account => account.provider) } : null);
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error) {
        if (error.code === 'P2025') return apiError(404, 'not_found', 'User not found.');
        if (['P2002', 'P2003', 'P2034'].includes(String(error.code))) return apiError(409, 'conflict', 'User has linked records, duplicate data, or changed concurrently.');
      }
      throw error;
    }
  });
}
