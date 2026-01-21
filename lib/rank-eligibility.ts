import { prisma } from '@/lib/prisma';

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
  currentRank: { id: number; name: string; abbreviation: string; orderIndex: number } | null;
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

const PRESENT_STATUSES = ['present', 'late', 'gone_early', 'partial'] as const;

export async function getCurrentAttendance(userId: number): Promise<number> {
  return prisma.attendance.count({
    where: {
      userId,
      orbat: { isMainOp: true },
      status: { in: PRESENT_STATUSES as any },
    },
  });
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
  const requiredAttendance = nextRank.attendanceRequiredSinceLastRank ?? 0;
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
    const completed = new Set(userTrainingIds.map((t) => t.trainingId));
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

  const reason: EligibilityReason = nextRank.autoRankupEnabled ? 'eligible_auto' : 'eligible_manual';

  return {
    eligible: true,
    reason,
    currentRank: {
      id: userRank.currentRank.id,
      name: userRank.currentRank.name,
      abbreviation: userRank.currentRank.abbreviation,
      orderIndex: userRank.currentRank.orderIndex,
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