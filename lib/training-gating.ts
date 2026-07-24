import { prisma } from '@/lib/prisma';
import {
  evaluateOrbatTrainingAccess,
  type OrbatTrainingAccess,
  type OrbatTrainingRequirement,
  type UserTrainingStatusRecord,
} from '@/lib/orbat-training-access';

export {
  evaluateOrbatTrainingAccess,
  formatOrbatTrainingAccessError,
  formatOrbatTrainingAccessWarnings,
} from '@/lib/orbat-training-access';
export type {
  OrbatTrainingAccess,
  OrbatTrainingAccessError,
  OrbatTrainingBlockReason,
  OrbatTrainingRequirement,
  OrbatTrainingRequirementAccess,
  UserTrainingStatusRecord,
  UserTrainingWorkflowStatus,
} from '@/lib/orbat-training-access';

export type TrainingRequirements = {
  minimumRank: { id: number; name: string; abbreviation: string } | null;
  requiredTrainings: Array<{ id: number; name: string; categoryName: string | null }>;
};

export type UnmetRequirements = {
  missingRank: { id: number; name: string; abbreviation: string } | null;
  missingTrainings: Array<{ id: number; name: string; categoryName: string | null }>;
};

/**
 * Load and evaluate a user's training access for an ORBAT slot.
 *
 * This is intentionally separate from `getUnmetRequirements`: temporary
 * `needs_qualify` access applies to ORBAT slots, not ordinary prerequisites.
 */
export async function getOrbatTrainingAccess(
  userId: number,
  requiredTrainingIds: number[]
): Promise<OrbatTrainingAccess> {
  const uniqueTrainingIds = Array.from(new Set(requiredTrainingIds));
  if (uniqueTrainingIds.length === 0) {
    return evaluateOrbatTrainingAccess([], []);
  }

  const [trainings, userTrainings] = await Promise.all([
    prisma.training.findMany({
      where: { id: { in: uniqueTrainingIds } },
      select: {
        id: true,
        name: true,
        requiresOrbatQualification: true,
      },
    }),
    prisma.userTraining.findMany({
      where: {
        userId,
        trainingId: { in: uniqueTrainingIds },
      },
      select: {
        trainingId: true,
        status: true,
      },
    }),
  ]);

  const trainingById = new Map(trainings.map((training) => [training.id, training]));
  const orderedRequirements: OrbatTrainingRequirement[] = uniqueTrainingIds.map(
    (trainingId) =>
      trainingById.get(trainingId) ?? {
        id: trainingId,
        name: `Training #${trainingId}`,
        requiresOrbatQualification: true,
      }
  );

  return evaluateOrbatTrainingAccess(
    orderedRequirements,
    userTrainings as UserTrainingStatusRecord[]
  );
}

/**
 * Get all requirements for a training (rank + training prerequisites)
 */
export async function getTrainingRequirements(trainingId: number): Promise<TrainingRequirements> {
  const training = await prisma.training.findUnique({
    where: { id: trainingId },
    include: {
      rankRequirement: {
        include: {
          minimumRank: {
            select: {
              id: true,
              name: true,
              abbreviation: true,
            },
          },
        },
      },
      requiresTrainings: {
        include: {
          requiredTraining: {
            select: {
              id: true,
              name: true,
              category: { select: { name: true } },
            },
          },
        },
      },
    },
  });

  if (!training) {
    return { minimumRank: null, requiredTrainings: [] };
  }

  return {
    minimumRank: training.rankRequirement?.minimumRank || null,
    requiredTrainings: training.requiresTrainings.map((r) => ({
      id: r.requiredTraining.id,
      name: r.requiredTraining.name,
      categoryName: r.requiredTraining.category?.name || null,
    })),
  };
}

/**
 * Check if a user can request a specific training based on requirements
 */
export async function canRequestTraining(userId: number, trainingId: number): Promise<boolean> {
  const unmet = await getUnmetRequirements(userId, trainingId);
  return !unmet.missingRank && unmet.missingTrainings.length === 0;
}

/**
 * Get unmet requirements for a user trying to request a training
 */
export async function getUnmetRequirements(
  userId: number,
  trainingId: number
): Promise<UnmetRequirements> {
  const requirements = await getTrainingRequirements(trainingId);

  const unmet: UnmetRequirements = {
    missingRank: null,
    missingTrainings: [],
  };

  // Check rank requirement
  if (requirements.minimumRank) {
    const userRank = await prisma.userRank.findUnique({
      where: { userId },
      include: {
        currentRank: {
          select: {
            id: true,
            name: true,
            abbreviation: true,
            orderIndex: true,
          },
        },
      },
    });

    const minimumRank = await prisma.rank.findUnique({
      where: { id: requirements.minimumRank.id },
      select: { orderIndex: true },
    });

    if (!userRank?.currentRank || !minimumRank) {
      unmet.missingRank = requirements.minimumRank;
    } else if (userRank.currentRank.orderIndex < minimumRank.orderIndex) {
      unmet.missingRank = requirements.minimumRank;
    }
  }

  // Check training prerequisites
  if (requirements.requiredTrainings.length > 0) {
    const userTrainings = await prisma.userTraining.findMany({
      where: {
        userId,
        trainingId: { in: requirements.requiredTrainings.map((t) => t.id) },
        status: { in: ['finished', 'qualified'] },
      },
      select: {
        trainingId: true,
        status: true,
        training: { select: { requiresOrbatQualification: true } },
      },
    });

    const completedIds = new Set(
      userTrainings
        .filter((item) => item.status === 'qualified' || !item.training.requiresOrbatQualification)
        .map((item) => item.trainingId),
    );
    unmet.missingTrainings = requirements.requiredTrainings.filter(
      (t) => !completedIds.has(t.id)
    );
  }

  return unmet;
}
