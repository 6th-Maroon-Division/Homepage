import type { Prisma } from '@/generated/prisma/client';
import type { ApiPrincipal } from './principal';
export function promotionVisibility(principal: ApiPrincipal): Prisma.PromotionProposalWhereInput {
  if ((principal.permissions['system:super_admin'] ?? 0) > 0) return {};
  return { user: { OR: [
    { id: principal.kind === 'user' ? principal.userId : -1 },
    { userPermissions: { none: { OR: [
      { permission: { key: 'system:super_admin' }, value: { gt: 0 } },
      { permission: { key: 'rank:manage_promotions' }, value: { gte: principal.permissions['rank:manage_promotions'] ?? 0 } },
    ] } } },
  ] } };
}
export const pendingPromotionSelect = {
  id: true, userId: true, currentRankId: true, nextRankId: true, attendanceTotalAtProposal: true, attendanceDeltaSinceLastRank: true, status: true, createdAt: true,
  user: { select: { id: true, username: true, accounts: { where: { provider: 'discord' }, orderBy: { id: 'asc' }, take: 1, select: { providerUserId: true } } } },
} as const;
