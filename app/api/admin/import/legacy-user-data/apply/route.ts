// app/api/admin/import/legacy-user-data/apply/route.ts
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';

// POST - Apply mapped legacy data to create/update UserRank entries
export async function POST() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  try {
    // Get all mapped but not yet applied legacy records
    const legacyRecords = await prisma.legacyUserData.findMany({
      where: {
        isMapped: true,
        isApplied: false,
        mappedUserId: { not: null },
      },
      include: {
        mappedUser: true,
      },
    });

    if (legacyRecords.length === 0) {
      return NextResponse.json({
        success: true,
        applied: 0,
        message: 'No mapped records to apply',
      });
    }

    // Get all ranks for lookup
    const ranks = await prisma.rank.findMany();
    const rankMap = new Map(ranks.map((r) => [r.abbreviation.toLowerCase(), r]));

    const results = {
      applied: 0,
      skipped: 0,
      errors: [] as string[],
    };

    // Process each record
    for (const legacyRecord of legacyRecords) {
      if (!legacyRecord.mappedUser) {
        results.skipped++;
        continue;
      }

      const rank = rankMap.get(legacyRecord.rankName.toLowerCase());
      if (!rank) {
        results.errors.push(
          `User ${legacyRecord.discordUsername}: Unknown rank ${legacyRecord.rankName}`
        );
        results.skipped++;
        continue;
      }

      try {
        await prisma.$transaction(async (tx) => {
          // Check if UserRank already exists
          const existingUserRank = await tx.userRank.findUnique({
            where: { userId: legacyRecord.mappedUserId! },
          });

          // Parse date joined for lastRankedUpAt
          let lastRankedUpAt: Date | null = null;
          if (legacyRecord.dateJoined) {
            try {
              // Try to parse the date (format: DD/MM/YYYY or D/M/YYYY)
              const parts = legacyRecord.dateJoined.split('/');
              if (parts.length === 3) {
                const day = parseInt(parts[0]);
                const month = parseInt(parts[1]) - 1; // JS months are 0-indexed
                const year = parseInt(parts[2]);
                lastRankedUpAt = new Date(year, month, day);
              }
            } catch {
              // If parsing fails, use null
              console.warn(`Failed to parse date for ${legacyRecord.discordUsername}: ${legacyRecord.dateJoined}`);
            }
          }

          if (existingUserRank) {
            // Update existing UserRank
            await tx.userRank.update({
              where: { userId: legacyRecord.mappedUserId! },
              data: {
                currentRankId: rank.id,
                attendanceSinceLastRank: legacyRecord.tigSinceLastPromo,
                lastRankedUpAt: lastRankedUpAt || existingUserRank.lastRankedUpAt,
              },
            });
          } else {
            // Create new UserRank
            await tx.userRank.create({
              data: {
                userId: legacyRecord.mappedUserId!,
                currentRankId: rank.id,
                attendanceSinceLastRank: legacyRecord.tigSinceLastPromo,
                lastRankedUpAt: lastRankedUpAt || undefined,
                retired: false,
                interviewDone: false,
              },
            });
          }

          // Create RankHistory entry
          await tx.rankHistory.create({
            data: {
              userId: legacyRecord.mappedUserId!,
              previousRankName: null, // No previous rank for legacy import
              newRankName: rank.name,
              attendanceTotalAtChange: legacyRecord.oldData, // Use oldData as historical total
              attendanceDeltaSinceLastRank: legacyRecord.tigSinceLastPromo,
              triggeredBy: 'import',
              triggeredByUserId: session.user.id,
              triggeredByDiscordId: null,
              outcome: 'approved',
              declineReason: null,
              note: `Legacy import: Date Joined ${legacyRecord.dateJoined || 'Unknown'}`,
            },
          });

          // Mark as applied
          await tx.legacyUserData.update({
            where: { id: legacyRecord.id },
            data: { isApplied: true },
          });
        });

        results.applied++;
      } catch (error) {
        console.error(`Failed to apply legacy data for ${legacyRecord.discordUsername}:`, error);
        results.errors.push(
          `User ${legacyRecord.discordUsername}: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
        results.skipped++;
      }
    }

    return NextResponse.json({
      success: true,
      applied: results.applied,
      skipped: results.skipped,
      errors: results.errors.length > 0 ? results.errors : undefined,
    });
  } catch (error) {
    console.error('Failed to apply legacy user data:', error);
    return NextResponse.json({ error: 'Failed to apply legacy user data' }, { status: 500 });
  }
}
