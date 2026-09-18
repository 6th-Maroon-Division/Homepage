import { prisma } from '@/lib/prisma';
import { canAccessApiUser } from './auth';
import { parsePositiveId } from './validation';
import { apiError } from './response';
import type { ApiPrincipal } from './principal';
export async function resolveRankUser(principal: ApiPrincipal, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const userId = id === 'me' && principal.kind === 'user' ? principal.userId : parsePositiveId(id);
  if (!userId || userId > 2147483647) return { error: apiError(400, 'invalid_request', 'Use a positive user id; me requires a user session.') } as const;
  if (!await canAccessApiUser(principal, userId, 'user:manage')) return { error: apiError(403, 'forbidden', 'Cannot access this user’s rank data.') } as const;
  if (!await prisma.user.findUnique({ where: { id: userId }, select: { id: true } })) return { error: apiError(404, 'not_found', 'User not found.') } as const;
  return { userId } as const;
}
export const rankHistorySelect = { id: true, previousRankName: true, newRankName: true, attendanceTotalAtChange: true, attendanceDeltaSinceLastRank: true, triggeredBy: true, outcome: true, declineReason: true, createdAt: true } as const;
