import { hasApiHierarchyPermission, parsePermissionGrants } from './permissions';
import type { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import type { ApiPrincipal } from './principal';
import type { ApiAuditContext } from './audit';
import { writeApiAudit } from './audit';
import { isSessionStaff, sessionActor, sessionId, sessionDatabaseError, safeSessionPublish } from './training-session-contract';
export { isSessionStaff as isRequestStaff, sessionActor as requestActor, sessionId as requestId, sessionDatabaseError as requestDatabaseError, safeSessionPublish as publishRequestEvent };
export const requestUserSelect = { id: true, username: true, avatarUrl: true } as const;
export function requestInclude(principal: ApiPrincipal) {
  const viewerId = sessionActor(principal) ?? 0;
  return {
    training: true, user: { select: requestUserSelect }, handledByAdmin: { select: requestUserSelect }, assignedTrainer: { select: requestUserSelect },
    messages: { orderBy: { id: 'desc' as const }, take: 1, include: { sender: { select: requestUserSelect } } },
    readStates: { where: { userId: viewerId }, take: 1 }, subscriptions: { where: { userId: viewerId }, take: 1 },
    sessionAttendee: { include: { session: { include: { trainer: { select: requestUserSelect } } } } },
  } satisfies Prisma.TrainingRequestInclude;
}
type RequestRecord = Prisma.TrainingRequestGetPayload<{ include: ReturnType<typeof requestInclude> }>;
type MessageRecord = Prisma.TrainingRequestMessageGetPayload<{ include: { sender: { select: typeof requestUserSelect } } }>;
export function serializeRequestMessage(message: MessageRecord, principal: ApiPrincipal) {
  const staff = isSessionStaff(principal);
  return { id: message.id, requestId: message.requestId, senderRole: message.senderRole, body: message.body, createdAt: message.createdAt.toISOString(), editedAt: message.editedAt?.toISOString() ?? null,
    sender: message.senderRole === 'STAFF' && !staff ? { id: null, username: 'Staff', avatarUrl: null } : message.sender,
    isMine: principal.kind === 'user' && message.senderId === principal.userId };
}
export function serializeTrainingRequest(row: RequestRecord, principal: ApiPrincipal) {
  const staff = isSessionStaff(principal);
  const session = row.sessionAttendee?.session;
  const confirmed = !!(session && ['scheduled', 'in_progress', 'completed'].includes(session.status) && session.startsAt);
  const last = row.messages[0] ?? null;
  const readState = row.readStates[0];
  const subscription = row.subscriptions[0];
  return {
    id: row.id, userId: row.userId, trainingId: row.trainingId, status: row.status, requestMessage: row.requestMessage, adminResponse: row.adminResponse,
    requestedAt: row.requestedAt.toISOString(), updatedAt: row.updatedAt.toISOString(), training: row.training, user: row.user,
    handledByAdmin: staff ? row.handledByAdmin : null, assignedTrainer: staff || confirmed ? row.assignedTrainer : null,
    lastMessage: last ? serializeRequestMessage(last, principal) : null,
    unread: principal.kind === 'user' && !!last && last.senderId !== principal.userId && last.id > (readState?.lastReadMessageId ?? 0),
    subscription: { websiteEnabled: subscription?.websiteEnabled ?? false, discordEnabled: subscription?.discordEnabled ?? false },
    session: session && (staff || confirmed) ? { id: session.id, trainingId: session.trainingId, startsAt: session.startsAt?.toISOString() ?? null, durationMinutes: session.durationMinutes, status: session.status, trainer: session.trainer, specialInstructions: session.specialInstructions, attendeeStatus: row.sessionAttendee?.status ?? null, server: 'Arma3 Training Server', confirmed } : null,
  };
}
export async function getTrainingRequest(id: number, principal: ApiPrincipal, database: Pick<Prisma.TransactionClient, 'trainingRequest'> = prisma) {
  const row = await database.trainingRequest.findUnique({ where: { id }, include: requestInclude(principal) });
  return row ? serializeTrainingRequest(row, principal) : null;
}
export async function auditTrainingRequestRead(audit: ApiAuditContext, rows: ReturnType<typeof serializeTrainingRequest>[], resourceId?: string) {
  const ids = [...new Set(rows.flatMap(row => [row.userId, row.handledByAdmin?.id, row.assignedTrainer?.id, row.session?.trainer?.id, row.lastMessage?.sender?.id]).filter((id): id is number => typeof id === 'number'))].filter(id => audit.principal?.kind !== 'user' || audit.principal.userId !== id);
  if (ids.length) await writeApiAudit(prisma, audit, { action: 'user_data.read', resource: 'training_request', resourceId, targetUserIds: ids, outcome: 'success' });
}

/** Staff authority for other users retains the permission level hierarchy. */
export async function canManageTrainingRequest(principal: ApiPrincipal, userId: number, database: Pick<Prisma.TransactionClient, 'userPermission'> = prisma) {
  if (principal.kind === 'user' && principal.userId === userId) return true;
  const rows = await database.userPermission.findMany({ where: { userId }, select: { value: true, permission: { select: { key: true } } } });
  const grants = parsePermissionGrants(Object.fromEntries(rows.map(row => [row.permission.key, row.value])));
  if (grants === null) return (principal.permissions['system:super_admin'] ?? 0) > 0;
  return ['training:approve_request', 'training:mark'].some(key => hasApiHierarchyPermission(principal.permissions, grants, key as 'training:approve_request'));
}
