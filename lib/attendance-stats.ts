import { prisma } from '@/lib/prisma';

export interface AttendanceStats {
  totalEvents: number;
  presentCount: number;
  lateCount: number;
  goneEarlyCount: number;
  partialCount: number;
  absentCount: number;
  noShowCount: number;
  attendancePercentage: number;
  avgMinutesMissed: number;
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

  const stats: AttendanceStats = {
    totalEvents: attendances.length,
    presentCount: attendances.filter(a => a.status === 'present').length,
    lateCount: attendances.filter(a => a.status === 'late').length,
    goneEarlyCount: attendances.filter(a => a.status === 'gone_early').length,
    partialCount: attendances.filter(a => a.status === 'partial').length,
    absentCount: attendances.filter(a => a.status === 'absent').length,
    noShowCount: attendances.filter(a => a.status === 'no_show').length,
    attendancePercentage: 0,
    avgMinutesMissed: 0,
  };

  if (stats.totalEvents > 0) {
    // Present + partial + late + gone_early count as attended
    const attended = stats.presentCount + stats.partialCount + stats.lateCount + stats.goneEarlyCount;
    stats.attendancePercentage = Math.round((attended / stats.totalEvents) * 100);

    // Calculate average minutes missed
    const totalMinuteMissed = attendances.reduce((sum, a) => sum + a.totalMinutesMissed, 0);
    stats.avgMinutesMissed = Math.round(totalMinuteMissed / stats.totalEvents);
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
          subslot: {
            include: {
              slot: {
                include: {
                  orbat: true,
                },
              },
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
          subslot: {
            include: {
              slot: true,
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
  });
}
