import { prisma } from './prisma';

/**
 * Processes unprocessed attendance events for a newly created user
 * Looks up AttendanceEvent records with matching steamId or discordId that have processed=false
 * and links them to the user, then marks them as processed.
 * Also handles duplicate events (join-join, leave-leave) by only keeping the first.
 * 
 * @param steamId - Optional Steam ID to match unprocessed events
 * @param discordId - Optional Discord ID to match unprocessed events
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
    // Find unprocessed events matching either steamId or discordId
    const unprocessedEvents = await prisma.attendanceEvent.findMany({
      where: {
        OR: [
          steamId ? { steamId, processed: false } : {},
          discordId ? { discordId, processed: false } : {},
        ],
      },
      orderBy: { eventTime: 'asc' },
    });

    if (unprocessedEvents.length === 0) {
      return { processedCount: 0 };
    }

    let processedCount = 0;
    let lastProcessedEventType: boolean | null = null;

    // Process events in order and handle duplicates
    for (const event of unprocessedEvents) {
      try {
        // Check if this would create a duplicate consecutive event
        // Skip if same type as last processed event (join-join or leave-leave)
        if (lastProcessedEventType === event.isJoin) {
          // Mark as processed but don't count it as a new event
          await prisma.attendanceEvent.update({
            where: { id: event.id },
            data: { 
              userId,
              processed: true,
            },
          });
          continue;
        }

        // Link event to user and mark as processed
        await prisma.attendanceEvent.update({
          where: { id: event.id },
          data: { 
            userId,
            processed: true,
          },
        });
        
        lastProcessedEventType = event.isJoin;
        processedCount++;
      } catch (error) {
        console.error(`Error processing pending event ${event.id}:`, error);
      }
    }

    return { processedCount };
  } catch (error) {
    console.error('Error processing pending events:', error);
    return { processedCount: 0 };
  }
}

/**
 * Get count of unprocessed attendance events for a specific Steam or Discord ID
 */
export async function getUnprocessedEventCount(
  steamId: string | null | undefined,
  discordId: string | null | undefined
): Promise<number> {
  if (!steamId && !discordId) {
    return 0;
  }

  const count = await prisma.attendanceEvent.count({
    where: {
      OR: [
        steamId ? { steamId, processed: false } : {},
        discordId ? { discordId, processed: false } : {},
      ],
    },
  });

  return count;
}

/**
 * Process all unprocessed attendance events (can be run as a background job)
 * This matches unprocessed events to users based on steamId or discordId
 */
export async function processAllUnprocessedEvents(): Promise<{ totalProcessed: number }> {
  try {
    const unprocessedEvents = await prisma.attendanceEvent.findMany({
      where: { 
        processed: false,
        OR: [
          { steamId: { not: null } },
          { discordId: { not: null } },
        ],
      },
      orderBy: { eventTime: 'asc' },
    });

    if (unprocessedEvents.length === 0) {
      return { totalProcessed: 0 };
    }

    let processedCount = 0;

    for (const event of unprocessedEvents) {
      try {
        // Try to find user by steamId or discordId
        let user = null;
        
        if (event.steamId) {
          const steamAccount = await prisma.authAccount.findUnique({
            where: {
              provider_providerUserId: {
                provider: 'steam',
                providerUserId: event.steamId,
              },
            },
            include: { user: true },
          });
          if (steamAccount) user = steamAccount.user;
        }

        if (!user && event.discordId) {
          const discordAccount = await prisma.authAccount.findUnique({
            where: {
              provider_providerUserId: {
                provider: 'discord',
                providerUserId: event.discordId,
              },
            },
            include: { user: true },
          });
          if (discordAccount) user = discordAccount.user;
        }

        if (user) {
          // Check for duplicate consecutive events for this user
          const lastEvent = await prisma.attendanceEvent.findFirst({
            where: {
              userId: user.id,
              processed: true,
            },
            orderBy: { eventTime: 'desc' },
          });

          // Only link if not a duplicate consecutive event
          if (!lastEvent || lastEvent.isJoin !== event.isJoin) {
            await prisma.attendanceEvent.update({
              where: { id: event.id },
              data: { 
                userId: user.id,
                processed: true,
              },
            });
            processedCount++;
          } else {
            // Mark as processed but it's a duplicate
            await prisma.attendanceEvent.update({
              where: { id: event.id },
              data: { 
                userId: user.id,
                processed: true,
              },
            });
          }
        }
        // If user still doesn't exist, leave it unprocessed for later
      } catch (error) {
        console.error(`Error processing unprocessed event ${event.id}:`, error);
      }
    }

    return { totalProcessed: processedCount };
  } catch (error) {
    console.error('Error processing all unprocessed events:', error);
    return { totalProcessed: 0 };
  }
}
