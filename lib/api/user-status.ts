import { prisma } from '@/lib/prisma';
import { apiError } from './response';
import { canAccessApiUser } from './auth';
import { writeApiAudit, type ApiAuditContext } from './audit';
import type { ApiPrincipal } from './principal';
import { publishUserProfileEvent } from '@/lib/realtime/user-events';
type StatusPatch = { interviewDone?: boolean; retired?: boolean };
type StatusUpdate = StatusPatch & { userId: number };
type Parsed<T> = { data: T; error?: never } | { error: Response; data?: never };
export function parseUserStatus(body: unknown): Parsed<StatusPatch> {
  const invalid = () => ({ error: apiError(422, 'validation_failed', 'Provide interviewDone and/or retired as booleans only.') });
  if (!body || typeof body !== 'object' || Array.isArray(body)) return invalid();
  const input = body as Record<string, unknown>;
  if (!Object.keys(input).length || Object.keys(input).some(key => !['interviewDone', 'retired'].includes(key))) return invalid();
  if (Object.values(input).some(value => typeof value !== 'boolean')) return invalid();
  return { data: { ...(typeof input.interviewDone === 'boolean' ? { interviewDone: input.interviewDone } : {}), ...(typeof input.retired === 'boolean' ? { retired: input.retired } : {}) } };
}
export function parseBulkUserStatus(body: unknown): Parsed<StatusUpdate[]> {
  const invalid = () => ({ error: apiError(422, 'validation_failed', 'Provide 1–100 unique user updates with numeric positive 32-bit userId and status flags.') });
  if (!body || typeof body !== 'object' || Array.isArray(body)) return invalid();
  const input = body as Record<string, unknown>;
  if (Object.keys(input).length !== 1 || !Array.isArray(input.updates) || !input.updates.length || input.updates.length > 100) return invalid();
  const data: StatusUpdate[] = [];
  const seen = new Set<number>();
  for (const row of input.updates) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return invalid();
    const { userId, ...flags } = row;
    if (typeof userId !== 'number' || !Number.isInteger(userId) || userId <= 0 || userId > 2147483647 || seen.has(userId)) return invalid();
    const parsed = parseUserStatus(flags);
    if (parsed.error) return parsed;
    seen.add(userId); data.push({ userId, ...parsed.data });
  }
  return { data };
}
export async function updateUserStatuses(principal: ApiPrincipal, audit: ApiAuditContext, updates: StatusUpdate[]): Promise<Parsed<{ userId: number; interviewDone: boolean; retired: boolean }[]>> {
  try {
    const result = await prisma.$transaction(async tx => {
      for (const { userId } of updates) {
        if (!await canAccessApiUser(principal, userId, 'user:manage', tx)) return { error: apiError(403, 'forbidden', 'Cannot manage one or more target users.') };
        if (!await tx.user.findUnique({ where: { id: userId }, select: { id: true } })) return { error: apiError(404, 'not_found', 'One or more target users do not exist.') };
      }
      const data = [];
      for (const { userId, ...flags } of updates) {
        const before = await tx.userRank.findUnique({ where: { userId }, select: { interviewDone: true, retired: true } });
        const after = await tx.userRank.upsert({ where: { userId }, create: { userId, ...flags }, update: flags, select: { userId: true, interviewDone: true, retired: true } });
        await writeApiAudit(tx, audit, { action: 'user_status.updated', resource: 'user_status', resourceId: String(userId), targetUserIds: [userId], outcome: 'success', before: { interviewDone: before?.interviewDone ?? false, retired: before?.retired ?? false }, after: { interviewDone: after.interviewDone, retired: after.retired } });
        data.push(after);
      }
      return { data };
    }, { isolationLevel: 'Serializable' });
    if (result.error) return { error: result.error };
    for (const { userId } of result.data!) {
      try { publishUserProfileEvent(userId, { source: 'user.status.updated' }); }
      catch { console.error('User status notification failed', { correlationId: audit.correlationId, timestamp: new Date().toISOString() }); }
    }
    return { data: result.data! };
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error) {
      if (error.code === 'P2025') return { error: apiError(404, 'not_found', 'User status not found.') };
      if (error.code === 'P2034' || error.code === 'P2002' || error.code === 'P2003') return { error: apiError(409, 'conflict', 'User status changed concurrently. Reload and retry.') };
    }
    throw error;
  }
}
