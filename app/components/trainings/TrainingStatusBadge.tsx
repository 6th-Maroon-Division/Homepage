export const TRAINING_WORKFLOW_STATUSES = [
  'pending',
  'approved',
  'in_training',
  'finished',
  'needs_qualify',
  'qualified',
  'failed',
  'rejected',
  'completed',
  'cancelled',
] as const;

export type TrainingWorkflowStatus = (typeof TRAINING_WORKFLOW_STATUSES)[number];

const STATUS_DETAILS: Record<
  TrainingWorkflowStatus,
  { label: string; backgroundColor: string; color: string; description: string }
> = {
  pending: {
    label: 'Pending',
    backgroundColor: '#2563eb',
    color: '#ffffff',
    description: 'Waiting for staff to review and schedule.',
  },
  approved: {
    label: 'Approved',
    backgroundColor: '#2563eb',
    color: '#ffffff',
    description: 'Approved and ready to be scheduled or started.',
  },
  in_training: {
    label: 'In Training',
    backgroundColor: '#7c3aed',
    color: '#ffffff',
    description: 'The training session is in progress.',
  },
  finished: {
    label: 'Finished',
    backgroundColor: '#16a34a',
    color: '#ffffff',
    description: 'The required training session is complete.',
  },
  needs_qualify: {
    label: 'Needs Qualification',
    backgroundColor: '#ea580c',
    color: '#ffffff',
    description: 'Temporary ORBAT access is active while practical qualification is pending.',
  },
  qualified: {
    label: 'Qualified',
    backgroundColor: '#16a34a',
    color: '#ffffff',
    description: 'Fully qualified.',
  },
  failed: {
    label: 'Failed',
    backgroundColor: '#dc2626',
    color: '#ffffff',
    description: 'A trainer must enable another qualification attempt.',
  },
  rejected: {
    label: 'Rejected',
    backgroundColor: '#dc2626',
    color: '#ffffff',
    description: 'The training request was declined.',
  },
  completed: {
    label: 'Completed',
    backgroundColor: '#16a34a',
    color: '#ffffff',
    description: 'Completed under the previous training workflow.',
  },
  cancelled: {
    label: 'Cancelled',
    backgroundColor: '#6b7280',
    color: '#ffffff',
    description: 'The training request or session was cancelled.',
  },
};

export function isTrainingWorkflowStatus(value: string): value is TrainingWorkflowStatus {
  return TRAINING_WORKFLOW_STATUSES.includes(value as TrainingWorkflowStatus);
}

export function getTrainingStatusDetails(status: string) {
  if (isTrainingWorkflowStatus(status)) {
    return STATUS_DETAILS[status];
  }

  return {
    label: status.replaceAll('_', ' ').replace(/\b\w/g, (character) => character.toUpperCase()),
    backgroundColor: '#6b7280',
    color: '#ffffff',
    description: 'Training workflow status.',
  };
}

export default function TrainingStatusBadge({
  status,
  showDescription = false,
}: {
  status: string;
  showDescription?: boolean;
}) {
  const details = getTrainingStatusDetails(status);

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span
        className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold"
        style={{ backgroundColor: details.backgroundColor, color: details.color }}
        title={details.description}
      >
        {details.label}
      </span>
      {showDescription && (
        <span className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
          {details.description}
        </span>
      )}
    </span>
  );
}
