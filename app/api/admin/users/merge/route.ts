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

type UserForeignKeyReference = {
  tableName: string;
  columnName: string;
};

type RemainingReference = {
  tableName: string;
  columnName: string;
  rowCount: bigint;
};

function quoteIdentifier(identifier: string) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new Error(`Unsafe identifier: ${identifier}`);
  }

  return `"${identifier}"`;
}

async function getUserForeignKeyReferences(tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) {
  const rows = await tx.$queryRaw<Array<UserForeignKeyReference>>`
    SELECT
      tc.table_name AS "tableName",
      kcu.column_name AS "columnName"
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON tc.constraint_name = ccu.constraint_name
      AND tc.table_schema = ccu.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema = 'public'
      AND ccu.table_schema = 'public'
      AND ccu.table_name = 'User'
      AND ccu.column_name = 'id'
  `;

  return rows.filter((row) => row.tableName !== 'User');
}

async function moveAllUserReferences(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  references: UserForeignKeyReference[],
  sourceUserId: number,
  targetUserId: number
) {
  let movedReferenceRows = 0;

  for (const reference of references) {
    const tableName = quoteIdentifier(reference.tableName);
    const columnName = quoteIdentifier(reference.columnName);
    const updatedRows = await tx.$executeRawUnsafe(
      `UPDATE ${tableName} SET ${columnName} = $1 WHERE ${columnName} = $2`,
      targetUserId,
      sourceUserId
    );
    movedReferenceRows += Number(updatedRows);
  }

  return movedReferenceRows;
}

async function countRemainingSourceReferences(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  references: UserForeignKeyReference[],
  sourceUserId: number
) {
  const remaining: RemainingReference[] = [];

  for (const reference of references) {
    const tableName = quoteIdentifier(reference.tableName);
    const columnName = quoteIdentifier(reference.columnName);
    const rows = await tx.$queryRawUnsafe<Array<{ rowCount: bigint }>>(
      `SELECT COUNT(*)::bigint AS "rowCount" FROM ${tableName} WHERE ${columnName} = $1`,
      sourceUserId
    );

    const rowCount = rows[0]?.rowCount ?? BigInt(0);
    if (rowCount > BigInt(0)) {
      remaining.push({
        tableName: reference.tableName,
        columnName: reference.columnName,
        rowCount,
      });
    }
  }

  return remaining;
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

      const userForeignKeyReferences = await getUserForeignKeyReferences(tx);
      result.updatedReferenceColumns = userForeignKeyReferences.length;

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
      ] = await Promise.all([
        tx.signup.findMany({ where: { userId: targetUserId }, select: { slotId: true } }),
        tx.userTraining.findMany({ where: { userId: targetUserId }, select: { trainingId: true } }),
        tx.userPermission.findMany({ where: { userId: targetUserId }, select: { permissionId: true } }),
        tx.promotionProposal.findMany({ where: { userId: targetUserId }, select: { nextRankId: true } }),
        tx.orbatAttendanceNote.findMany({ where: { userId: targetUserId }, select: { orbatId: true } }),
        tx.messageRecipient.findMany({ where: { userId: targetUserId }, select: { messageId: true } }),
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
          select: { id: true },
        });

        if (duplicateRows.length > 0) {
          await tx.userTraining.deleteMany({ where: { id: { in: duplicateRows.map((row) => row.id) } } });
          result.droppedDuplicateTrainings = duplicateRows.length;
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

      result.movedReferenceRows = await moveAllUserReferences(
        tx,
        userForeignKeyReferences,
        sourceUserId,
        targetUserId
      );

      const remainingReferences = await countRemainingSourceReferences(tx, userForeignKeyReferences, sourceUserId);
      result.remainingSourceReferences = remainingReferences.reduce(
        (total, reference) => total + Number(reference.rowCount),
        0
      );

      if (remainingReferences.length > 0) {
        const details = remainingReferences
          .map((reference) => `${reference.tableName}.${reference.columnName}=${reference.rowCount.toString()}`)
          .join(', ');
        throw new Error(`Unable to migrate all user references: ${details}`);
      }

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
