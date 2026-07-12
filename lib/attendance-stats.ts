import { prisma } from '@/lib/prisma';

export interface AttendanceStats {
  totalEvents: number;
  presentCount: number;
  lateCount: number;
  goneEarlyCount: number;
  arrivedLateCount: number;
  leftEarlyCount: number;
  partialCount: number;
  absentCount: number;
  noShowCount: number;
  attendancePercentage: number;
  avgMinutesMissed: number;
  avgArrivedLatePerMonth: number;
  avgLeftEarlyPerMonth: number;
}

/**
 * Get total attendance count including legacy data for verification purposes
 * @param userId - User ID
 * @returns Total attendance count including new system and legacy data
 */
export async function getTotalAttendanceWithLegacy(userId: number): Promise<number> {
  // Count attendance from new system
  const newAttendanceCount = await prisma.attendance.count({
    where: { userId },
  });

  // Count attendance from legacy system (2024 to today) - individual attendance events
  const legacyAttendanceCount = await prisma.legacyAttendanceData.count({
    where: {
      mappedUserId: userId,
      legacyStatus: { in: ['P'] }, // Only count Present status
    },
  });

  // Get old attendance data (before 2024) from LegacyUserData
  const legacyUserData = await prisma.legacyUserData.findMany({
    where: {
      mappedUserId: userId,
      isApplied: true, // Only count if legacy data has been applied
      oldData: { gt: 0 }, // Only include records with actual attendance data
    },
    select: { oldData: true },
  });

  // Sum up all old legacy attendance for this user
  const oldLegacyAttendance = legacyUserData.reduce((sum: number, record: { oldData: number }) => sum + record.oldData, 0);

  // Total attendance = new system + legacy system (2024-today) + old system (before 2024)
  return newAttendanceCount + legacyAttendanceCount + oldLegacyAttendance;
}

// Type for combined attendance record (new system + legacy)
interface LegacyAttendanceRecord {
  id: number;
  createdAt: Date;
  status: string;
  legacyStatus?: string;
  legacyEventDate?: Date | string;
  isLegacy: boolean;
  orbat?: { name: string; eventDate: Date | null };
}

/**
 * Get recent attendance including legacy data for user history display
 * Efficiently combines new system and legacy attendance in one call pattern
 */
export async function getRecentAttendanceWithLegacy(
  userId: number,
  limit: number = 15
): Promise<Array<{
  id: number;
  createdAt: Date;
  status: string;
  orbatName: string;
  orbatDate: Date | string;
  isLegacy: boolean;
}>> {
  // Get recent attendance from new system
  const newAttendance = await prisma.attendance.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: {
      orbat: {
        select: { name: true, eventDate: true },
      },
    },
  });

  // Get recent legacy attendance events
  const legacyAttendance = await prisma.legacyAttendanceData.findMany({
    where: {
      mappedUserId: userId,
      legacyStatus: { in: ['P'] }, // Only include Present status
    },
    orderBy: { legacyEventDate: 'desc' },
    take: limit,
  });

  // Normalize and combine to match existing format
  const normalizedNew = newAttendance.map((a) => ({
    id: a.id,
    orbatName: a.orbat?.name || 'Unknown ORBAT',
    orbatDate: a.orbat?.eventDate || a.createdAt,
    status: a.status,
    isLegacy: false,
    createdAt: a.createdAt,
  }));

  const normalizedLegacy = legacyAttendance.map((l) => ({
    id: l.id,
    orbatName: 'Legacy Attendance', // No orbat info for legacy data
    orbatDate: l.legacyEventDate || new Date(),
    status: l.legacyStatus,
    isLegacy: true,
    createdAt: l.legacyEventDate || new Date(),
  }));

  // Combine and sort by date (newest first)
  const combined = [...normalizedNew, ...normalizedLegacy];
  
  // Sort by date descending
  combined.sort((a, b) => {
    const dateA = a.orbatDate instanceof Date ? a.orbatDate : new Date(a.orbatDate);
    const dateB = b.orbatDate instanceof Date ? b.orbatDate : new Date(b.orbatDate);
    return dateB.getTime() - dateA.getTime();
  });

  return combined.slice(0, limit); // Return only the requested limit
}

/**
 * Get 6-month trend data (new system only; legacy excluded)
 * Returns monthly attendance counts for the last 6 months
 */
export async function getSixMonthTrendWithLegacy(userId: number): Promise<Date[]> {
  const now = new Date();
  const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);

  // Get new system attendance for trend (only new system, no legacy as per user requirement)
  const newAttendance = await prisma.attendance.findMany({
    where: {
      userId,
      createdAt: { gte: sixMonthsAgo },
    },
    select: { createdAt: true },
  });

  // Return just the dates for buildLastSixMonthsTrend to process
  return newAttendance.map(a => a.createdAt);
}

/**
 * Calculate attendance statistics for a user over a given period
 * @param userId - User ID
 * @param daysBack - How many days back to calculate (default: 30)
 * @returns Attendance statistics
 */
export async function getUserAttendanceStats(
  userId: number,
  daysBack: number = 30
): Promise<AttendanceStats> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysBack);

  const attendances = await prisma.attendance.findMany({
    where: {
      userId,
      createdAt: {
        gte: cutoffDate,
      },
    },
  });

  const periodMonths = Math.max(1, Math.ceil(daysBack / 30));
  const arrivedLateCount = attendances.filter(a => a.minutesLate > 0).length;
  const leftEarlyCount = attendances.filter(a => a.minutesGoneEarly > 0).length;

  const stats: AttendanceStats = {
    totalEvents: attendances.length,
    presentCount: attendances.filter(a => a.status === 'present').length,
    lateCount: attendances.filter(a => a.status === 'late').length,
    goneEarlyCount: attendances.filter(a => a.status === 'gone_early').length,
    arrivedLateCount,
    leftEarlyCount,
    partialCount: attendances.filter(a => a.status === 'partial').length,
    absentCount: attendances.filter(a => a.status === 'absent').length,
    noShowCount: attendances.filter(a => a.status === 'no_show').length,
    attendancePercentage: 0,
    avgMinutesMissed: 0,
    avgArrivedLatePerMonth: 0,
    avgLeftEarlyPerMonth: 0,
  };

  if (stats.totalEvents > 0) {
    // Present + partial + late + gone_early count as attended
    const attended = stats.presentCount + stats.partialCount + stats.lateCount + stats.goneEarlyCount;
    stats.attendancePercentage = Math.round((attended / stats.totalEvents) * 100);

    // Calculate average minutes missed
    const totalMinuteMissed = attendances.reduce((sum, a) => sum + a.totalMinutesMissed, 0);
    stats.avgMinutesMissed = Math.round(totalMinuteMissed / stats.totalEvents);

    stats.avgArrivedLatePerMonth = Number((arrivedLateCount / periodMonths).toFixed(2));
    stats.avgLeftEarlyPerMonth = Number((leftEarlyCount / periodMonths).toFixed(2));
  }

  return stats;
}

/**
 * Get attendance records for a user with optional date filtering
 */
export async function getUserAttendanceRecords(
  userId: number,
  daysBack?: number,
  limit: number = 50
) {
  const where: {
    userId: number;
    createdAt?: {
      gte: Date;
    };
  } = {
    userId,
  };

  if (daysBack) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysBack);
    where.createdAt = {
      gte: cutoffDate,
    };
  }

  return prisma.attendance.findMany({
    where,
    include: {
      signup: {
        include: {
          slot: {
            include: {
              orbat: true,
            },
          },
        },
      },
      logs: {
        include: {
          changedBy: true,
        },
        orderBy: {
          timestamp: 'desc',
        },
      },
    },
    orderBy: {
      createdAt: 'desc',
    },
    take: limit,
  });
}

/**
 * Get all attendance for an orbat with optional user filter
 */
export async function getOrbatAttendance(
  orbatId: number,
  userId?: number
) {
  return prisma.attendance.findMany({
    where: {
      orbatId,
      ...(userId && { userId }),
    },
    include: {
      signup: {
        include: {
          user: true,
          slot: true,
        },
      },
      logs: {
        include: {
          changedBy: true,
        },
        orderBy: {
          timestamp: 'desc',
        },
      },
    },
    orderBy: {
      createdAt: 'desc',
    },
  });
}
