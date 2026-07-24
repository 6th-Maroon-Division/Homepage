import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { checkPermission } from '@/lib/auth-middleware';
import { prisma } from '@/lib/prisma';
import { publishUserProfileEvent } from '@/lib/realtime/user-events';

type MergeRequestBody = {
  sourceUserId?: number;
  targetUserId?: number;
};

type MergeSummary = {
  movedAccounts: number;
  discardedAccounts: number;
  droppedDuplicateSignups: number;
  droppedDuplicateTrainings: number;
  droppedDuplicatePermissions: number;
  droppedDuplicatePromotionProposals: number;
  droppedDuplicateAttendanceNotes: number;
  droppedDuplicateMessageRecipients: number;
  updatedReferenceColumns: number;
  movedReferenceRows: number;
  remainingSourceReferences: number;
};

function getCsrfCookieToken(request: NextRequest) {
  const cookieValue =
    request.cookies.get('__Host-next-auth.csrf-token')?.value ??
    request.cookies.get('next-auth.csrf-token')?.value ??
    null;

  if (!cookieValue) {
    return null;
  }

  const [token] = cookieValue.split('|');
  return token || null;
}

function hasValidCsrfToken(request: NextRequest) {
  const headerToken = request.headers.get('x-csrf-token')?.trim() ?? '';
  const cookieToken = getCsrfCookieToken(request)?.trim() ?? '';

  if (!headerToken || !cookieToken) {
    return false;
  }

  if (headerToken.length !== cookieToken.length) {
    return false;
  }

  let diff = 0;
  for (let i = 0; i < headerToken.length; i += 1) {
    diff |= headerToken.charCodeAt(i) ^ cookieToken.charCodeAt(i);
  }

  return diff === 0;
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const hasPermission = await checkPermission(session.user.id, 'user:manage');
    if (!hasPermission) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (!hasValidCsrfToken(request)) {
      return NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 });
    }

    const body = (await request.json()) as MergeRequestBody;
    const sourceUserId = Number(body?.sourceUserId);
    const targetUserId = Number(body?.targetUserId);

    if (!Number.isInteger(sourceUserId) || sourceUserId <= 0) {
      return NextResponse.json({ error: 'Invalid source user ID' }, { status: 400 });
    }

    if (!Number.isInteger(targetUserId) || targetUserId <= 0) {
      return NextResponse.json({ error: 'Invalid target user ID' }, { status: 400 });
    }

    if (sourceUserId === targetUserId) {
      return NextResponse.json({ error: 'Source and target must be different users' }, { status: 400 });
    }

    if (sourceUserId === session.user.id) {
      return NextResponse.json({ error: 'Cannot merge and delete your own account' }, { status: 400 });
    }

    const [sourceUser, targetUser] = await Promise.all([
      prisma.user.findUnique({ where: { id: sourceUserId }, select: { id: true } }),
      prisma.user.findUnique({ where: { id: targetUserId }, select: { id: true } }),
    ]);

    if (!sourceUser || !targetUser) {
      return NextResponse.json({ error: 'Source or target user not found' }, { status: 404 });
    }

    const summary = await prisma.$transaction(async (tx) => {
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
        remainingSourceReferences: 0,
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
        tx.signup.findMany({ where: { userId: targetUserId }, select: { slotId: true } }),
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
          select: { id: true },
        });

        if (duplicateRows.length > 0) {
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
            );
            if (!targetTraining) continue;

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
          const targetRow = targetTrainingSessionAttendances.find((row) => row.sessionId === sourceRow.sessionId);
          if (!targetRow) continue;
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
          await tx.trainingSessionAttendee.delete({ where: { id: sourceRow.id } });
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
          const targetRow = targetTrainingReadStates.find((row) => row.requestId === sourceRow.requestId);
          if (!targetRow) continue;
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
          const targetRow = targetTrainingSubscriptions.find((row) => row.requestId === sourceRow.requestId);
          if (!targetRow) continue;
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

      return result;
    });

    const eventPayload = {
      action: 'account.merged',
      actorUserId: session.user.id,
      sourceUserId,
      targetUserId,
      summary,
    };

    publishUserProfileEvent(targetUserId, eventPayload);
    publishUserProfileEvent(sourceUserId, eventPayload);

    return NextResponse.json({
      success: true,
      mergedIntoUserId: targetUserId,
      removedUserId: sourceUserId,
      summary,
    });
  } catch (error) {
    console.error('Error merging users:', error);
    return NextResponse.json({ error: 'Failed to merge users' }, { status: 500 });
  }
}
