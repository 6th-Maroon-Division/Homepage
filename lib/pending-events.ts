import { prisma } from './prisma';

/**
 * Processes pending attendance events for a newly created user
 * Looks up pending events by Steam ID or Discord ID and converts them to regular attendance events
 * @param steamId - Optional Steam ID to match pending events
 * @param discordId - Optional Discord ID to match pending events
 * @param userId - The new user's ID to link events to
 */
export async function processPendingEventsForUser(
  steamId: string | null | undefined,
  discordId: string | null | undefined,
  userId: number
): Promise<{ processedCount: number }> {
  if (!steamId && !discordId) {
    return { processedCount: 0 };
  }

  try {
    // Find pending events matching either steamId or discordId
    const pendingEvents = await prisma.pendingAttendanceEvent.findMany({
      where: {
        OR: [
          steamId ? { steamId } : {},
          discordId ? { discordId } : {},
        ],
        processedAt: null, // Only process unprocessed events
      },
      orderBy: { eventTime: 'asc' },
    });

    if (pendingEvents.length === 0) {
      return { processedCount: 0 };
    }

    // Convert pending events to regular attendance events
    const now = new Date();
    const results = await Promise.allSettled(
      pendingEvents.map(async (pendingEvent) => {
        try {
          await prisma.attendanceEvent.create({
            data: {
              userId,
              isJoin: pendingEvent.isJoin,
              eventTime: pendingEvent.eventTime,
            },
          });

          // Mark as processed
          await prisma.pendingAttendanceEvent.update({
            where: { id: pendingEvent.id },
            data: { processedAt: now },
          });

          return { success: true };
        } catch {
          return { success: false };
        }
      })
    );

    const successful = results.filter((r) => r.status === 'fulfilled' && r.value.success).length;
    
    return { processedCount: successful };
  } catch (error) {
    console.error('Error processing pending events:', error);
    return { processedCount: 0 };
  }
}

/**
 * Get count of unprocessed pending events for a specific Steam or Discord ID
 */
export async function getPendingEventCount(
  steamId: string | null | undefined,
  discordId: string | null | undefined
): Promise<number> {
  if (!steamId && !discordId) {
    return 0;
  }

  const count = await prisma.pendingAttendanceEvent.count({
    where: {
      OR: [
        steamId ? { steamId } : {},
        discordId ? { discordId } : {},
      ],
      processedAt: null,
    },
  });

  return count;
}

/**
 * Process pending events for all users (can be run as a background job)
 */
export async function processAllPendingEvents(): Promise<{ totalProcessed: number }> {
  try {
    const pendingEvents = await prisma.pendingAttendanceEvent.findMany({
      where: { processedAt: null },
      orderBy: { createdAt: 'asc' },
    });

    if (pendingEvents.length === 0) {
      return { totalProcessed: 0 };
    }

    const now = new Date();
    let processedCount = 0;

    for (const pendingEvent of pendingEvents) {
      try {
        // Try to find user by steamId or discordId
        let user = null;
        
        if (pendingEvent.steamId) {
          const steamAccount = await prisma.authAccount.findUnique({
            where: {
              provider_providerUserId: {
                provider: 'steam',
                providerUserId: pendingEvent.steamId,
              },
            },
            include: { user: true },
          });
          if (steamAccount) user = steamAccount.user;
        }

        if (!user && pendingEvent.discordId) {
          const discordAccount = await prisma.authAccount.findUnique({
            where: {
              provider_providerUserId: {
                provider: 'discord',
                providerUserId: pendingEvent.discordId,
              },
            },
            include: { user: true },
          });
          if (discordAccount) user = discordAccount.user;
        }

        if (user) {
          // Create attendance event for this user
          await prisma.attendanceEvent.create({
            data: {
              userId: user.id,
              isJoin: pendingEvent.isJoin,
              eventTime: pendingEvent.eventTime,
            },
          });

          // Mark as processed
          await prisma.pendingAttendanceEvent.update({
            where: { id: pendingEvent.id },
            data: { processedAt: now },
          });

          processedCount++;
        }
        // If user still doesn't exist, leave it unprocessed for later
      } catch (error) {
        console.error(`Error processing pending event ${pendingEvent.id}:`, error);
      }
    }

    return { totalProcessed: processedCount };
  } catch (error) {
    console.error('Error processing all pending events:', error);
    return { totalProcessed: 0 };
  }
}
