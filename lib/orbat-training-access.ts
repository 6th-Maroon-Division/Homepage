export type UserTrainingWorkflowStatus =
  | 'approved'
  | 'in_training'
  | 'finished'
  | 'needs_qualify'
  | 'qualified'
  | 'failed';

export type OrbatTrainingRequirement = {
  id: number;
  name: string;
  requiresOrbatQualification: boolean;
};

export type UserTrainingStatusRecord = {
  trainingId: number;
  status: UserTrainingWorkflowStatus;
};

export type OrbatTrainingBlockReason =
  | 'failed'
  | 'not_started'
  | 'training_incomplete'
  | 'qualification_required';

export type OrbatTrainingRequirementAccess = OrbatTrainingRequirement & {
  status: UserTrainingWorkflowStatus | null;
  access: 'permanent' | 'temporary' | 'blocked';
  blockReason: OrbatTrainingBlockReason | null;
};

export type OrbatTrainingAccess = {
  allowed: boolean;
  hasTemporaryAccess: boolean;
  requirements: OrbatTrainingRequirementAccess[];
  temporaryRequirements: OrbatTrainingRequirementAccess[];
  blockedRequirements: OrbatTrainingRequirementAccess[];
};

export type OrbatTrainingAccessError = {
  code:
    | 'TRAINING_QUALIFICATION_REQUIRED'
    | 'TRAINING_INCOMPLETE'
    | 'TRAINING_NOT_STARTED';
  error: string;
};

function evaluateRequirement(
  requirement: OrbatTrainingRequirement,
  status: UserTrainingWorkflowStatus | null
): OrbatTrainingRequirementAccess {
  if (status === 'qualified') {
    return { ...requirement, status, access: 'permanent', blockReason: null };
  }

  if (status === 'needs_qualify') {
    return requirement.requiresOrbatQualification
      ? { ...requirement, status, access: 'temporary', blockReason: null }
      : { ...requirement, status, access: 'blocked', blockReason: 'training_incomplete' };
  }

  if (status === 'finished') {
    return requirement.requiresOrbatQualification
      ? { ...requirement, status, access: 'blocked', blockReason: 'qualification_required' }
      : { ...requirement, status, access: 'permanent', blockReason: null };
  }

  if (status === 'failed') {
    return { ...requirement, status, access: 'blocked', blockReason: 'failed' };
  }

  if (status === 'approved' || status === 'in_training') {
    return { ...requirement, status, access: 'blocked', blockReason: 'training_incomplete' };
  }

  return { ...requirement, status: null, access: 'blocked', blockReason: 'not_started' };
}

/**
 * Evaluate training access specifically for an ORBAT slot.
 *
 * `needs_qualify` is deliberately accepted only here as temporary access. It
 * must not be treated as completion for training prerequisites or rank gates.
 */
export function evaluateOrbatTrainingAccess(
  requiredTrainings: OrbatTrainingRequirement[],
  userTrainings: UserTrainingStatusRecord[]
): OrbatTrainingAccess {
  const statusByTrainingId = new Map(
    userTrainings.map((record) => [record.trainingId, record.status])
  );

  const requirements = requiredTrainings.map((requirement) =>
    evaluateRequirement(requirement, statusByTrainingId.get(requirement.id) ?? null)
  );
  const temporaryRequirements = requirements.filter(
    (requirement) => requirement.access === 'temporary'
  );
  const blockedRequirements = requirements.filter(
    (requirement) => requirement.access === 'blocked'
  );

  return {
    allowed: blockedRequirements.length === 0,
    hasTemporaryAccess: temporaryRequirements.length > 0,
    requirements,
    temporaryRequirements,
    blockedRequirements,
  };
}

function joinTrainingNames(requirements: OrbatTrainingRequirementAccess[]) {
  return requirements.map((requirement) => requirement.name).join(', ');
}

export function formatOrbatTrainingAccessError(
  access: OrbatTrainingAccess
): OrbatTrainingAccessError | null {
  if (access.allowed) {
    return null;
  }

  const qualificationRequired = access.blockedRequirements.filter(
    (requirement) =>
      requirement.blockReason === 'failed' ||
      requirement.blockReason === 'qualification_required'
  );
  if (qualificationRequired.length > 0) {
    const names = joinTrainingNames(qualificationRequired);
    return {
      code: 'TRAINING_QUALIFICATION_REQUIRED',
      error: `You need ${names} qualification${qualificationRequired.length === 1 ? '' : 's'}. Contact a trainer.`,
    };
  }

  const incomplete = access.blockedRequirements.filter(
    (requirement) => requirement.blockReason === 'training_incomplete'
  );
  if (incomplete.length > 0) {
    return {
      code: 'TRAINING_INCOMPLETE',
      error: `You must complete ${joinTrainingNames(incomplete)} before signing up for this slot.`,
    };
  }

  return {
    code: 'TRAINING_NOT_STARTED',
    error: `This slot requires ${joinTrainingNames(access.blockedRequirements)}. Request training first.`,
  };
}

export function formatOrbatTrainingAccessWarnings(access: OrbatTrainingAccess): string[] {
  const warnings: string[] = [];
  const qualificationRequired = access.blockedRequirements.filter(
    (requirement) =>
      requirement.blockReason === 'failed' ||
      requirement.blockReason === 'qualification_required'
  );
  const incomplete = access.blockedRequirements.filter(
    (requirement) => requirement.blockReason === 'training_incomplete'
  );
  const missing = access.blockedRequirements.filter(
    (requirement) => requirement.blockReason === 'not_started'
  );

  if (qualificationRequired.length > 0) {
    warnings.push(
      `User needs qualification for required trainings: ${joinTrainingNames(qualificationRequired)}`
    );
  }
  if (incomplete.length > 0) {
    warnings.push(
      `User has not completed required trainings: ${joinTrainingNames(incomplete)}`
    );
  }
  if (missing.length > 0) {
    warnings.push(`User is missing required trainings: ${joinTrainingNames(missing)}`);
  }

  return warnings;
}
