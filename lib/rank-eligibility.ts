import { prisma } from '@/lib/prisma';
import type { AttendanceStatus } from '@/generated/prisma/enums';

// Present statuses for attendance counting
const PRESENT_STATUSES_ARRAY = ['present', 'late', 'gone_early', 'partial'] as AttendanceStatus[];

export type EligibilityReason =
  | 'eligible_auto'
  | 'eligible_manual'
  | 'ineligible_retired'
  | 'ineligible_interview'
  | 'ineligible_no_current_rank'
  | 'ineligible_no_next_rank'
  | 'ineligible_attendance'
  | 'ineligible_training';

export type EligibilityResult = {
  eligible: boolean;
  reason: EligibilityReason;
  currentRank: { id: number; name: string; abbreviation: string; orderIndex: number; autoRankupEnabled: boolean; attendanceRequiredSinceLastRank: number | null } | null;
  nextRank: { id: number; name: string; abbreviation: string; orderIndex: number; autoRankupEnabled: boolean; attendanceRequiredSinceLastRank: number | null } | null;
  attendance: {
    currentAttendance: number;
    attendanceSinceLastRank: number;
    requiredAttendance: number | null;
    delta: number;
  };
  missingTrainingIds?: number[];
  proposalId?: number | null;
};

/**
 * Get current attendance count for rank eligibility, including legacy data
 * This counts only present attendance on main operations from all time periods
 */
export async function getCurrentAttendance(userId: number): Promise<number> {
  // Count attendance from new system
  // Fetch counts and legacy user data in parallel to reduce latency
  const [newAttendanceCount, legacyAttendanceCount, legacyUserData] = await Promise.all([
    prisma.attendance.count({
      where: {
        userId,
        orbat: { isMainOp: true },
        status: { in: PRESENT_STATUSES_ARRAY },
      },
    }),
    prisma.legacyAttendanceData.count({
      where: {
        mappedUserId: userId,
        legacyStatus: { in: ['P'] }, // Only count Present status from legacy data
      },
    }),
    prisma.legacyUserData.findMany({
      where: {
        mappedUserId: userId,
        isApplied: true, // Only count if legacy data has been applied
        oldData: { gt: 0 }, // Only include records with actual attendance data
      },
      select: { oldData: true },
    }),
  ]);

  // Sum up all old legacy attendance for this user
  const oldLegacyAttendance = legacyUserData.reduce((sum: number, record: { oldData: number }) => sum + record.oldData, 0);

  // Total attendance = new system + legacy system (2024-today) + old system (before 2024)
  return newAttendanceCount + legacyAttendanceCount + oldLegacyAttendance;
}

/**
 * Get total attendance count including all legacy data (for display purposes)
 * This counts all attendance regardless of ORBAT type or status
 */
export async function getTotalAttendanceWithLegacy(userId: number): Promise<number> {
  // Count all attendance from new system
  const newAttendanceCount = await prisma.attendance.count({
    where: { userId },
  });

  // Count all attendance from legacy system (2024 to today)
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
      isApplied: true,
      oldData: { gt: 0 },
    },
    select: { oldData: true },
  });

  const oldLegacyAttendance = legacyUserData.reduce((sum: number, record: { oldData: number }) => sum + record.oldData, 0);

  return newAttendanceCount + legacyAttendanceCount + oldLegacyAttendance;
}

export async function checkRankupEligibility(userId: number): Promise<EligibilityResult> {
  const userRank = await prisma.userRank.findUnique({
    where: { userId },
    include: {
      currentRank: true,
    },
  });

  if (!userRank || !userRank.currentRank) {
    return {
      eligible: false,
      reason: 'ineligible_no_current_rank',
      currentRank: null,
      nextRank: null,
      attendance: {
        currentAttendance: 0,
        attendanceSinceLastRank: 0,
        requiredAttendance: null,
        delta: 0,
      },
      proposalId: null,
    };
  }

  if (userRank.retired) {
    return {
      eligible: false,
      reason: 'ineligible_retired',
      currentRank: {
        id: userRank.currentRank.id,
        name: userRank.currentRank.name,
        abbreviation: userRank.currentRank.abbreviation,
        orderIndex: userRank.currentRank.orderIndex,
        autoRankupEnabled: userRank.currentRank.autoRankupEnabled,
        attendanceRequiredSinceLastRank: userRank.currentRank.attendanceRequiredSinceLastRank,
      },
      nextRank: null,
      attendance: {
        currentAttendance: 0,
        attendanceSinceLastRank: userRank.attendanceSinceLastRank,
        requiredAttendance: null,
        delta: 0,
      },
      proposalId: null,
    };
  }

  if (!userRank.interviewDone) {
    return {
      eligible: false,
      reason: 'ineligible_interview',
      currentRank: {
        id: userRank.currentRank.id,
        name: userRank.currentRank.name,
        abbreviation: userRank.currentRank.abbreviation,
        orderIndex: userRank.currentRank.orderIndex,
        autoRankupEnabled: userRank.currentRank.autoRankupEnabled,
        attendanceRequiredSinceLastRank: userRank.currentRank.attendanceRequiredSinceLastRank,
      },
      nextRank: null,
      attendance: {
        currentAttendance: 0,
        attendanceSinceLastRank: userRank.attendanceSinceLastRank,
        requiredAttendance: null,
        delta: 0,
      },
      proposalId: null,
    };
  }

  const nextRank = await prisma.rank.findFirst({
    where: { orderIndex: { gt: userRank.currentRank.orderIndex } },
    orderBy: { orderIndex: 'asc' },
  });

  if (!nextRank) {
    return {
      eligible: false,
      reason: 'ineligible_no_next_rank',
      currentRank: {
        id: userRank.currentRank.id,
        name: userRank.currentRank.name,
        abbreviation: userRank.currentRank.abbreviation,
        orderIndex: userRank.currentRank.orderIndex,
        autoRankupEnabled: userRank.currentRank.autoRankupEnabled,
        attendanceRequiredSinceLastRank: userRank.currentRank.attendanceRequiredSinceLastRank,
      },
      nextRank: null,
      attendance: {
        currentAttendance: 0,
        attendanceSinceLastRank: userRank.attendanceSinceLastRank,
        requiredAttendance: null,
        delta: 0,
      },
      proposalId: null,
    };
  }

  const currentAttendance = await getCurrentAttendance(userId);
  const requiredAttendance = userRank.currentRank.attendanceRequiredSinceLastRank ?? 0;
  const delta = currentAttendance - userRank.attendanceSinceLastRank;

  if (requiredAttendance > 0 && delta < requiredAttendance) {
    return {
      eligible: false,
      reason: 'ineligible_attendance',
      currentRank: {
        id: userRank.currentRank.id,
        name: userRank.currentRank.name,
        abbreviation: userRank.currentRank.abbreviation,
        orderIndex: userRank.currentRank.orderIndex,
        autoRankupEnabled: userRank.currentRank.autoRankupEnabled,
        attendanceRequiredSinceLastRank: userRank.currentRank.attendanceRequiredSinceLastRank,
      },
      nextRank: {
        id: nextRank.id,
        name: nextRank.name,
        abbreviation: nextRank.abbreviation,
        orderIndex: nextRank.orderIndex,
        autoRankupEnabled: nextRank.autoRankupEnabled,
        attendanceRequiredSinceLastRank: nextRank.attendanceRequiredSinceLastRank,
      },
      attendance: {
        currentAttendance,
        attendanceSinceLastRank: userRank.attendanceSinceLastRank,
        requiredAttendance,
        delta,
      },
      proposalId: null,
    };
  }

  const transitionRequirement = await prisma.rankTransitionRequirement.findUnique({
    where: { targetRankId: nextRank.id },
    include: { requiredTrainings: { select: { id: true } } },
  });

  let missingTrainingIds: number[] | undefined;
  if (transitionRequirement && transitionRequirement.requiredTrainings.length > 0) {
    const requiredIds = transitionRequirement.requiredTrainings.map((t) => t.id);
    const userTrainingIds = await prisma.userTraining.findMany({
      where: { userId },
      select: { trainingId: true },
    });
    const completed = new Set(userTrainingIds.map((t) => t.trainingId).filter((id): id is number => id !== null && id !== undefined));
    missingTrainingIds = requiredIds.filter((id) => !completed.has(id));

    if (missingTrainingIds.length > 0) {
      return {
        eligible: false,
        reason: 'ineligible_training',
        currentRank: {
          id: userRank.currentRank.id,
          name: userRank.currentRank.name,
          abbreviation: userRank.currentRank.abbreviation,
          orderIndex: userRank.currentRank.orderIndex,
          autoRankupEnabled: userRank.currentRank.autoRankupEnabled,
          attendanceRequiredSinceLastRank: userRank.currentRank.attendanceRequiredSinceLastRank,
        },
        nextRank: {
          id: nextRank.id,
          name: nextRank.name,
          abbreviation: nextRank.abbreviation,
          orderIndex: nextRank.orderIndex,
          autoRankupEnabled: nextRank.autoRankupEnabled,
          attendanceRequiredSinceLastRank: nextRank.attendanceRequiredSinceLastRank,
        },
        attendance: {
          currentAttendance,
          attendanceSinceLastRank: userRank.attendanceSinceLastRank,
          requiredAttendance,
          delta,
        },
        missingTrainingIds,
        proposalId: null,
      };
    }
  }

  const existingProposal = await prisma.promotionProposal.findFirst({
    where: {
      userId,
      nextRankId: nextRank.id,
      status: 'pending',
    },
    select: { id: true },
  });

  const reason: EligibilityReason = userRank.currentRank.autoRankupEnabled ? 'eligible_auto' : 'eligible_manual';

  return {
    eligible: true,
    reason,
    currentRank: {
      id: userRank.currentRank.id,
      name: userRank.currentRank.name,
      abbreviation: userRank.currentRank.abbreviation,
      orderIndex: userRank.currentRank.orderIndex,
      autoRankupEnabled: userRank.currentRank.autoRankupEnabled,
      attendanceRequiredSinceLastRank: userRank.currentRank.attendanceRequiredSinceLastRank,
    },
    nextRank: {
      id: nextRank.id,
      name: nextRank.name,
      abbreviation: nextRank.abbreviation,
      orderIndex: nextRank.orderIndex,
      autoRankupEnabled: nextRank.autoRankupEnabled,
      attendanceRequiredSinceLastRank: nextRank.attendanceRequiredSinceLastRank,
    },
    attendance: {
      currentAttendance,
      attendanceSinceLastRank: userRank.attendanceSinceLastRank,
      requiredAttendance,
      delta,
    },
    missingTrainingIds,
    proposalId: existingProposal?.id || null,
  };
}