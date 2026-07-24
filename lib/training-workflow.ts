export const ACTIVE_TRAINING_REQUEST_STATUSES = [
  'pending',
  'approved',
  'in_training',
  'needs_qualify',
] as const;

export const TRAINING_REQUEST_STATUSES = [
  ...ACTIVE_TRAINING_REQUEST_STATUSES,
  'finished',
  'qualified',
  'failed',
  'rejected',
  'cancelled',
  'completed',
] as const;

export type TrainingRequestWorkflowStatus = (typeof TRAINING_REQUEST_STATUSES)[number];

export const USER_TRAINING_STATUSES = [
  'approved',
  'in_training',
  'finished',
  'needs_qualify',
  'qualified',
  'failed',
] as const;

export type UserTrainingWorkflowStatus = (typeof USER_TRAINING_STATUSES)[number];

export type TrainingWorkflowConfiguration = {
  requiresTrainingSession: boolean;
  requiresOrbatQualification: boolean;
};

const BASE_TRANSITIONS: Record<TrainingRequestWorkflowStatus, readonly TrainingRequestWorkflowStatus[]> = {
  pending: ['approved', 'rejected', 'cancelled'],
  approved: [],
  in_training: ['finished', 'failed', 'needs_qualify'],
  finished: ['needs_qualify'],
  needs_qualify: ['qualified', 'failed'],
  qualified: ['needs_qualify'],
  failed: ['needs_qualify'],
  rejected: [],
  cancelled: [],
  completed: [],
};

export function isTrainingRequestStatus(value: unknown): value is TrainingRequestWorkflowStatus {
  return typeof value === 'string' && TRAINING_REQUEST_STATUSES.includes(value as TrainingRequestWorkflowStatus);
}

export function isUserTrainingStatus(value: unknown): value is UserTrainingWorkflowStatus {
  return typeof value === 'string' && USER_TRAINING_STATUSES.includes(value as UserTrainingWorkflowStatus);
}

export function getAllowedTrainingTransitions(
  current: TrainingRequestWorkflowStatus,
  configuration: TrainingWorkflowConfiguration,
): TrainingRequestWorkflowStatus[] {
  if (current !== 'approved') {
    return [...BASE_TRANSITIONS[current]];
  }

  if (configuration.requiresTrainingSession) {
    return ['in_training', 'failed'];
  }

  if (configuration.requiresOrbatQualification) {
    return ['needs_qualify', 'failed'];
  }

  return ['finished', 'qualified', 'failed'];
}

export function validateTrainingTransition(
  current: TrainingRequestWorkflowStatus,
  next: TrainingRequestWorkflowStatus,
  configuration: TrainingWorkflowConfiguration,
): { valid: true } | { valid: false; reason: string } {
  if (current === next) {
    return { valid: true };
  }

  if (next === 'needs_qualify' && !configuration.requiresOrbatQualification) {
    return {
      valid: false,
      reason: 'This training does not require an ORBAT qualification.',
    };
  }

  const allowed = getAllowedTrainingTransitions(current, configuration);
  if (!allowed.includes(next)) {
    return {
      valid: false,
      reason: `Training request cannot move from ${current} to ${next}. Allowed: ${allowed.join(', ') || 'none'}.`,
    };
  }

  if (current === 'in_training' && next === 'finished' && configuration.requiresOrbatQualification) {
    return {
      valid: false,
      reason: 'This training requires an ORBAT qualification and must move to needs_qualify after the session.',
    };
  }

  return { valid: true };
}

export function requestStatusToUserTrainingStatus(
  status: TrainingRequestWorkflowStatus,
): UserTrainingWorkflowStatus | null {
  switch (status) {
    case 'approved':
    case 'in_training':
    case 'finished':
    case 'needs_qualify':
    case 'qualified':
    case 'failed':
      return status;
    case 'completed':
      return 'qualified';
    default:
      return null;
  }
}

export function isFullTrainingCompletion(
  status: UserTrainingWorkflowStatus,
  configuration: TrainingWorkflowConfiguration,
): boolean {
  return status === 'qualified' || (status === 'finished' && !configuration.requiresOrbatQualification);
}
