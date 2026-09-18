import { prisma } from '@/lib/prisma';
import { PERMISSIONS, type PermissionKey } from '@/lib/permissions';
import { publishUserProfileEvent } from '@/lib/realtime/user-events';
import { handleApiRequest } from './handler';
import { canAccessApiUser } from './auth';
import { hasApiPermission } from './permissions';
import { writeApiAudit } from './audit';
import { readJsonBody } from './request';
import { apiError, apiSuccess } from './response';
type MergeSummary = {
  movedAccounts: number; discardedAccounts: number; droppedDuplicateSignups: number; droppedDuplicateTrainings: number;
  droppedDuplicatePermissions: number; droppedDuplicatePromotionProposals: number; droppedDuplicateAttendanceNotes: number;
  droppedDuplicateMessageRecipients: number; updatedReferenceColumns: number; movedReferenceRows: number;
};
export function hasMergeCsrfToken(request: Request): boolean {
  const header = request.headers.get('x-csrf-token')?.trim();
  if (!header) return false;
  try {
    const cookies = new Map((request.headers.get('cookie') ?? '').split(';').map(part => { const separator = part.indexOf('='); return [part.slice(0, separator).trim(), part.slice(separator + 1)] as const; }));
    const cookie = decodeURIComponent(cookies.get('__Host-next-auth.csrf-token') ?? cookies.get('next-auth.csrf-token') ?? '').split('|')[0];
    if (!cookie || cookie.length !== header.length) return false;
    let difference = 0;
    for (let i = 0; i < header.length; i++) difference |= header.charCodeAt(i) ^ cookie.charCodeAt(i);
    return difference === 0;
  } catch { return false; }
}
export async function mergeUsers(request: Request) {
  return handleApiRequest(request, 'user:manage', async (principal, context) => {
    if (new URL(request.url).searchParams.size) return apiError(400, 'invalid_request', 'No query parameters supported.');
    if (principal.kind === 'user' && !hasMergeCsrfToken(request)) return apiError(403, 'forbidden', 'A valid session CSRF token is required for account merging.');
    const body = await readJsonBody(request);
    const validId = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 2147483647;
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !['sourceUserId', 'targetUserId'].includes(key)) || !('sourceUserId' in body) || !('targetUserId' in body) || !validId(body.sourceUserId) || !validId(body.targetUserId) || body.sourceUserId === body.targetUserId) return apiError(422, 'validation_failed', 'Use distinct numeric positive Int32 sourceUserId and targetUserId.');
    const { sourceUserId, targetUserId } = body;
    if (principal.kind === 'user' && [sourceUserId, targetUserId].includes(principal.userId)) return apiError(403, 'forbidden', 'You cannot merge either side of your own account.');
    try {
      const merged = await prisma.$transaction(async tx => {
        const users = await tx.user.findMany({ where: { id: { in: [sourceUserId, targetUserId] } }, select: { id: true } });
        if (users.length !== 2) return { error: apiError(404, 'not_found', 'Source or target user not found.') };
        for (const id of [sourceUserId, targetUserId]) if (!(await canAccessApiUser(principal, id, 'user:manage', tx))) return { error: apiError(403, 'forbidden', 'You cannot manage both users.') };
        const sourceGrants = await tx.userPermission.findMany({ where: { userId: sourceUserId }, select: { permissionId: true, value: true, permission: { select: { key: true, maxValue: true } } } });
        const targetGrantIds = new Set((await tx.userPermission.findMany({ where: { userId: targetUserId }, select: { permissionId: true } })).map(grant => grant.permissionId));
        const inheritedGrants = sourceGrants.filter(grant => grant.value > 0 && !targetGrantIds.has(grant.permissionId));
        if (inheritedGrants.length && !hasApiPermission(principal.permissions, 'user:manage_permissions')) return { error: apiError(403, 'forbidden', 'Inheriting user permissions requires user:manage_permissions.') };
        for (const grant of inheritedGrants) {
          if (!Object.hasOwn(PERMISSIONS, grant.permission.key) || grant.value > grant.permission.maxValue || grant.value > 255) return { error: apiError(422, 'validation_failed', 'A source permission cannot be inherited at its current value.') };
          if ((principal.permissions['system:super_admin'] ?? 0) <= 0 && (grant.permission.key === 'system:super_admin' || grant.value >= (principal.permissions[grant.permission.key as PermissionKey] ?? 0))) return { error: apiError(403, 'forbidden', 'Inherited grants must be strictly below your own corresponding permission levels.') };
        }
      const result: MergeSummary = {
        movedAccounts: 0,
        discardedAccounts: 0,
        droppedDuplicateSignups: 0,
        droppedDuplicateTrainings: 0,
        droppedDuplicatePermissions: 0,
        droppedDuplicatePromotionProposals: 0,
        droppedDuplicateAttendanceNotes: 0,
        droppedDuplicateMessageRecipients: 0,
        updatedReferenceColumns: 0,
        movedReferenceRows: 0,
      };

      const [sourceAccounts, targetAccounts] = await Promise.all([
        tx.authAccount.findMany({ where: { userId: sourceUserId } }),
        tx.authAccount.findMany({ where: { userId: targetUserId } }),
      ]);

      const targetProviders = new Set(targetAccounts.map((account) => account.provider));
      for (const account of sourceAccounts) {
        if (targetProviders.has(account.provider)) {
          await tx.authAccount.delete({ where: { id: account.id } });
          result.discardedAccounts += 1;
          continue;
        }

        await tx.authAccount.update({
          where: { id: account.id },
          data: { userId: targetUserId },
        });
        targetProviders.add(account.provider);
        result.movedAccounts += 1;
      }

      const [
        targetSignups,
        targetTrainings,
        targetPermissions,
        targetPromotionProposals,
        targetAttendanceNotes,
        targetMessageRecipients,
        targetTrainingSessionAttendances,
        targetTrainingReadStates,
        targetTrainingSubscriptions,
      ] = await Promise.all([
        tx.signup.findMany({ where: { userId: targetUserId }, select: { id: true, slotId: true } }),
        tx.userTraining.findMany({ where: { userId: targetUserId } }),
        tx.userPermission.findMany({ where: { userId: targetUserId }, select: { permissionId: true } }),
        tx.promotionProposal.findMany({ where: { userId: targetUserId }, select: { nextRankId: true } }),
        tx.orbatAttendanceNote.findMany({ where: { userId: targetUserId }, select: { orbatId: true } }),
        tx.messageRecipient.findMany({ where: { userId: targetUserId }, select: { messageId: true } }),
        tx.trainingSessionAttendee.findMany({ where: { userId: targetUserId } }),
        tx.trainingRequestReadState.findMany({ where: { userId: targetUserId } }),
        tx.trainingRequestSubscription.findMany({ where: { userId: targetUserId } }),
      ]);

      if (targetSignups.length > 0) {
        const duplicateRows = await tx.signup.findMany({
          where: {
            userId: sourceUserId,
            slotId: { in: targetSignups.map((row) => row.slotId) },
          },
          select: { id: true, slotId: true },
        });

        if (duplicateRows.length > 0) {
          for (const signup of duplicateRows) {
            const targetSignup = targetSignups.find(row => row.slotId === signup.slotId)!;
            const sourceAttendance = await tx.attendance.findUnique({ where: { signupId: signup.id } });
            if (!sourceAttendance) continue;
            const targetAttendance = await tx.attendance.findUnique({ where: { signupId: targetSignup.id } });
            if (targetAttendance) {
              await tx.attendanceSession.updateMany({ where: { attendanceId: sourceAttendance.id }, data: { attendanceId: targetAttendance.id } });
              await tx.attendanceLog.updateMany({ where: { attendanceId: sourceAttendance.id }, data: { attendanceId: targetAttendance.id } });
              const present = ['present', 'late', 'gone_early', 'partial'];
              await tx.attendance.update({ where: { id: targetAttendance.id }, data: {
                status: present.includes(targetAttendance.status) ? targetAttendance.status : sourceAttendance.status,
                totalMinutesPresent: Math.max(targetAttendance.totalMinutesPresent, sourceAttendance.totalMinutesPresent),
                notes: targetAttendance.notes ?? sourceAttendance.notes,
              } });
              await tx.attendance.delete({ where: { id: sourceAttendance.id } });
            } else await tx.attendance.update({ where: { id: sourceAttendance.id }, data: { signupId: targetSignup.id } });
          }
          await tx.signup.deleteMany({ where: { id: { in: duplicateRows.map((row) => row.id) } } });
          result.droppedDuplicateSignups = duplicateRows.length;
        }
      }

      if (targetTrainings.length > 0) {
        const duplicateRows = await tx.userTraining.findMany({
          where: {
            userId: sourceUserId,
            trainingId: { in: targetTrainings.map((row) => row.trainingId) },
          },
        });

        if (duplicateRows.length > 0) {
          const statusPriority = {
            failed: 0,
            approved: 1,
            in_training: 2,
            finished: 3,
            needs_qualify: 4,
            qualified: 5,
          } as const;

          for (const sourceTraining of duplicateRows) {
            const targetTraining = targetTrainings.find(
              (row) => row.trainingId === sourceTraining.trainingId,
            )!; // The source query restricts trainingId to this target set.

            if (statusPriority[sourceTraining.status] > statusPriority[targetTraining.status]) {
              await tx.userTraining.update({
                where: { id: targetTraining.id },
                data: {
                  status: sourceTraining.status,
                  trainerId: sourceTraining.trainerId ?? targetTraining.trainerId,
                  completedAt: sourceTraining.completedAt,
                  needsRetraining: sourceTraining.needsRetraining,
                  isHidden: targetTraining.isHidden && sourceTraining.isHidden,
                  notes: sourceTraining.notes ?? targetTraining.notes,
                  trainingSessionCompletedAt: sourceTraining.trainingSessionCompletedAt ?? targetTraining.trainingSessionCompletedAt,
                  orbatQualifiedAt: sourceTraining.orbatQualifiedAt ?? targetTraining.orbatQualifiedAt,
                  failedAt: sourceTraining.failedAt ?? targetTraining.failedAt,
                  statusUpdatedAt: sourceTraining.statusUpdatedAt,
                },
              });
            }

            await tx.userTrainingStatusHistory.updateMany({
              where: { userTrainingId: sourceTraining.id },
              data: { userTrainingId: targetTraining.id },
            });
            await tx.userTraining.delete({ where: { id: sourceTraining.id } });
          }
          result.droppedDuplicateTrainings = duplicateRows.length;
        }
      }

      if (targetTrainingSessionAttendances.length > 0) {
        const sourceRows = await tx.trainingSessionAttendee.findMany({
          where: {
            userId: sourceUserId,
            sessionId: { in: targetTrainingSessionAttendances.map((row) => row.sessionId) },
          },
        });
        const attendeePriority = { cancelled: 0, scheduled: 1, absent: 1, attended: 2, completed: 3 } as const;
        for (const sourceRow of sourceRows) {
          const targetRow = targetTrainingSessionAttendances.find((row) => row.sessionId === sourceRow.sessionId)!;
          await tx.trainingSessionAttendee.delete({ where: { id: sourceRow.id } });
          await tx.trainingSessionAttendee.update({
            where: { id: targetRow.id },
            data: {
              status: attendeePriority[sourceRow.status] > attendeePriority[targetRow.status] ? sourceRow.status : targetRow.status,
              attendedAt: targetRow.attendedAt ?? sourceRow.attendedAt,
              completedAt: targetRow.completedAt ?? sourceRow.completedAt,
              notes: targetRow.notes ?? sourceRow.notes,
              trainingRequestId: targetRow.trainingRequestId ?? sourceRow.trainingRequestId,
            },
          });
        }
      }

      if (targetTrainingReadStates.length > 0) {
        const sourceRows = await tx.trainingRequestReadState.findMany({
          where: {
            userId: sourceUserId,
            requestId: { in: targetTrainingReadStates.map((row) => row.requestId) },
          },
        });
        for (const sourceRow of sourceRows) {
          const targetRow = targetTrainingReadStates.find((row) => row.requestId === sourceRow.requestId)!;
          const useSource = Boolean(
            sourceRow.lastReadAt && (!targetRow.lastReadAt || sourceRow.lastReadAt > targetRow.lastReadAt),
          );
          if (useSource) {
            await tx.trainingRequestReadState.update({
              where: { id: targetRow.id },
              data: { lastReadAt: sourceRow.lastReadAt, lastReadMessageId: sourceRow.lastReadMessageId },
            });
          }
          await tx.trainingRequestReadState.delete({ where: { id: sourceRow.id } });
        }
      }

      if (targetTrainingSubscriptions.length > 0) {
        const sourceRows = await tx.trainingRequestSubscription.findMany({
          where: {
            userId: sourceUserId,
            requestId: { in: targetTrainingSubscriptions.map((row) => row.requestId) },
          },
        });
        for (const sourceRow of sourceRows) {
          const targetRow = targetTrainingSubscriptions.find((row) => row.requestId === sourceRow.requestId)!;
          await tx.trainingRequestSubscription.update({
            where: { id: targetRow.id },
            data: {
              websiteEnabled: targetRow.websiteEnabled || sourceRow.websiteEnabled,
              discordEnabled: targetRow.discordEnabled || sourceRow.discordEnabled,
            },
          });
          await tx.trainingRequestSubscription.delete({ where: { id: sourceRow.id } });
        }
      }

      if (targetPermissions.length > 0) {
        const duplicateRows = await tx.userPermission.findMany({
          where: {
            userId: sourceUserId,
            permissionId: { in: targetPermissions.map((row) => row.permissionId) },
          },
          select: { id: true },
        });

        if (duplicateRows.length > 0) {
          await tx.userPermission.deleteMany({ where: { id: { in: duplicateRows.map((row) => row.id) } } });
          result.droppedDuplicatePermissions = duplicateRows.length;
        }
      }

      if (targetPromotionProposals.length > 0) {
        const duplicateRows = await tx.promotionProposal.findMany({
          where: {
            userId: sourceUserId,
            nextRankId: { in: targetPromotionProposals.map((row) => row.nextRankId) },
          },
          select: { id: true },
        });

        if (duplicateRows.length > 0) {
          await tx.promotionProposal.deleteMany({ where: { id: { in: duplicateRows.map((row) => row.id) } } });
          result.droppedDuplicatePromotionProposals = duplicateRows.length;
        }
      }

      if (targetAttendanceNotes.length > 0) {
        const duplicateRows = await tx.orbatAttendanceNote.findMany({
          where: {
            userId: sourceUserId,
            orbatId: { in: targetAttendanceNotes.map((row) => row.orbatId) },
          },
          select: { id: true },
        });

        if (duplicateRows.length > 0) {
          await tx.orbatAttendanceNote.deleteMany({ where: { id: { in: duplicateRows.map((row) => row.id) } } });
          result.droppedDuplicateAttendanceNotes = duplicateRows.length;
        }
      }

      if (targetMessageRecipients.length > 0) {
        const duplicateRows = await tx.messageRecipient.findMany({
          where: {
            userId: sourceUserId,
            messageId: { in: targetMessageRecipients.map((row) => row.messageId) },
          },
          select: { id: true },
        });

        if (duplicateRows.length > 0) {
          await tx.messageRecipient.deleteMany({ where: { id: { in: duplicateRows.map((row) => row.id) } } });
          result.droppedDuplicateMessageRecipients = duplicateRows.length;
        }
      }

      const [sourceRank, targetRank] = await Promise.all([
        tx.userRank.findUnique({ where: { userId: sourceUserId } }),
        tx.userRank.findUnique({ where: { userId: targetUserId } }),
      ]);

      if (sourceRank && !targetRank) {
        await tx.userRank.update({
          where: { id: sourceRank.id },
          data: { userId: targetUserId },
        });
      }

      if (sourceRank && targetRank) {
        await tx.userRank.update({
          where: { id: targetRank.id },
          data: {
            currentRankId: targetRank.currentRankId ?? sourceRank.currentRankId,
            attendanceSinceLastRank: Math.max(targetRank.attendanceSinceLastRank, sourceRank.attendanceSinceLastRank),
            retired: targetRank.retired || sourceRank.retired,
            interviewDone: targetRank.interviewDone || sourceRank.interviewDone,
            lastRankedUpAt:
              targetRank.lastRankedUpAt.getTime() <= sourceRank.lastRankedUpAt.getTime()
                ? targetRank.lastRankedUpAt
                : sourceRank.lastRankedUpAt,
          },
        });

        await tx.userRank.delete({ where: { id: sourceRank.id } });
      }

      const sourcePreference = await tx.userNotificationPreference.findUnique({ where: { userId: sourceUserId } });
      if (sourcePreference && !(await tx.userNotificationPreference.findUnique({ where: { userId: targetUserId } }))) await tx.userNotificationPreference.update({ where: { id: sourcePreference.id }, data: { userId: targetUserId } });

      const movedReferences = await Promise.all([
        tx.orbat.updateMany({ where: { createdById: sourceUserId }, data: { createdById: targetUserId } }),
        tx.orbatTemplate.updateMany({ where: { createdById: sourceUserId }, data: { createdById: targetUserId } }),
        tx.signup.updateMany({ where: { userId: sourceUserId }, data: { userId: targetUserId } }),
        tx.userTraining.updateMany({ where: { userId: sourceUserId }, data: { userId: targetUserId } }),
        tx.userTraining.updateMany({ where: { trainerId: sourceUserId }, data: { trainerId: targetUserId } }),
        tx.userTrainingStatusHistory.updateMany({ where: { changedById: sourceUserId }, data: { changedById: targetUserId } }),
        tx.trainingRequest.updateMany({ where: { userId: sourceUserId }, data: { userId: targetUserId } }),
        tx.trainingRequest.updateMany({ where: { handledByAdminId: sourceUserId }, data: { handledByAdminId: targetUserId } }),
        tx.trainingRequest.updateMany({ where: { assignedTrainerId: sourceUserId }, data: { assignedTrainerId: targetUserId } }),
        tx.trainingSession.updateMany({ where: { trainerId: sourceUserId }, data: { trainerId: targetUserId } }),
        tx.trainingSession.updateMany({ where: { createdById: sourceUserId }, data: { createdById: targetUserId } }),
        tx.trainingSessionAttendee.updateMany({ where: { userId: sourceUserId }, data: { userId: targetUserId } }),
        tx.trainingRequestMessage.updateMany({ where: { senderId: sourceUserId }, data: { senderId: targetUserId } }),
        tx.trainingRequestReadState.updateMany({ where: { userId: sourceUserId }, data: { userId: targetUserId } }),
        tx.trainingRequestSubscription.updateMany({ where: { userId: sourceUserId }, data: { userId: targetUserId } }),
        tx.attendance.updateMany({ where: { userId: sourceUserId }, data: { userId: targetUserId } }),
        tx.attendanceSession.updateMany({ where: { userId: sourceUserId }, data: { userId: targetUserId } }),
        tx.attendanceLog.updateMany({ where: { changedById: sourceUserId }, data: { changedById: targetUserId } }),
        tx.attendanceEvent.updateMany({ where: { userId: sourceUserId }, data: { userId: targetUserId } }),
        tx.legacyAttendanceData.updateMany({ where: { mappedUserId: sourceUserId }, data: { mappedUserId: targetUserId } }),
        tx.legacyUserData.updateMany({ where: { mappedUserId: sourceUserId }, data: { mappedUserId: targetUserId } }),
        tx.message.updateMany({ where: { createdById: sourceUserId }, data: { createdById: targetUserId } }),
        tx.messageRecipient.updateMany({ where: { userId: sourceUserId }, data: { userId: targetUserId } }),
        tx.rankHistory.updateMany({ where: { userId: sourceUserId }, data: { userId: targetUserId } }),
        tx.promotionProposal.updateMany({ where: { userId: sourceUserId }, data: { userId: targetUserId } }),
        tx.userPermission.updateMany({ where: { userId: sourceUserId }, data: { userId: targetUserId } }),
        tx.permissionAuditLog.updateMany({ where: { actorId: sourceUserId }, data: { actorId: targetUserId } }),
        tx.permissionAuditLog.updateMany({ where: { targetUserId: sourceUserId }, data: { targetUserId } }),
        tx.squadRoleAuditLog.updateMany({ where: { changedById: sourceUserId }, data: { changedById: targetUserId } }),
        tx.leaveOfAbsence.updateMany({ where: { userId: sourceUserId }, data: { userId: targetUserId } }),
        tx.botToken.updateMany({ where: { createdById: sourceUserId }, data: { createdById: targetUserId } }),
        tx.orbatAttendanceNote.updateMany({ where: { userId: sourceUserId }, data: { userId: targetUserId } }),
      ]);
      result.updatedReferenceColumns = movedReferences.length;
      result.movedReferenceRows = movedReferences.reduce((total, update) => total + update.count, 0);

      await tx.user.delete({ where: { id: sourceUserId } });

      await writeApiAudit(tx, context, { action: 'user.merged', resource: 'user', resourceId: String(targetUserId), targetUserIds: [sourceUserId, targetUserId], outcome: 'success', before: { sourceUserId, targetUserId }, after: { removedUserId: sourceUserId, mergedIntoUserId: targetUserId, inheritedPermissions: inheritedGrants.map(grant => ({ permissionId: grant.permissionId, value: grant.value })), summary: result } });
      return { summary: result };
      }, { isolationLevel: 'Serializable', timeout: 60000 });
      if (merged.error) return merged.error;
      for (const userId of [sourceUserId, targetUserId]) try { publishUserProfileEvent(userId, { action: 'account.merged', actorUserId: principal.kind === 'user' ? principal.userId : null, sourceUserId, targetUserId }); } catch { console.error('Merge notification failed', { correlationId: context.correlationId, timestamp: new Date().toISOString() }); }
      return apiSuccess({ mergedIntoUserId: targetUserId, removedUserId: sourceUserId, summary: merged.summary });
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error) {
        if (error.code === 'P2025') return apiError(404, 'not_found', 'A merge reference no longer exists.');
        if (['P2002', 'P2003', 'P2034'].includes(String(error.code))) return apiError(409, 'conflict', 'Accounts changed concurrently or contain conflicting references. Reload and retry.');
      }
      throw error;
    }
  });
}
