'use client';

import { useMemo, useState } from 'react';
import LoadingSpinner from '@/app/components/ui/LoadingSpinner';
import { useToast } from '@/app/components/ui/ToastContainer';
import TrainingStatusBadge from './TrainingStatusBadge';

type StatusAction = {
  status: string;
  label: string;
  description: string;
  destructive?: boolean;
};

function getStatusActions(
  status: string,
  requiresTrainingSession: boolean,
  requiresOrbatQualification: boolean,
): StatusAction[] {
  switch (status) {
    case 'pending':
      return [
        { status: 'approved', label: 'Approve Request', description: 'Allow staff to schedule or begin this training.' },
        { status: 'rejected', label: 'Reject Request', description: 'Close the request without granting training access.', destructive: true },
      ];
    case 'approved':
      if (requiresTrainingSession) {
        return [
          { status: 'in_training', label: 'Start Training', description: 'Record that the theoretical training session has started.' },
          { status: 'failed', label: 'Mark Failed', description: 'Record that this attempt did not pass.', destructive: true },
        ];
      }
      if (requiresOrbatQualification) {
        return [
          { status: 'needs_qualify', label: 'Enable ORBAT Qualification', description: 'Grant temporary slot access for a practical attempt.' },
          { status: 'failed', label: 'Mark Failed', description: 'Record that this attempt did not pass.', destructive: true },
        ];
      }
      return [
        { status: 'finished', label: 'Mark Finished', description: 'Complete this training without a session or practical qualification.' },
        { status: 'qualified', label: 'Mark Qualified', description: 'Grant full qualification directly.' },
        { status: 'failed', label: 'Mark Failed', description: 'Record that this attempt did not pass.', destructive: true },
      ];
    case 'in_training':
      return [
        requiresOrbatQualification
          ? { status: 'needs_qualify', label: 'Session Passed', description: 'Finish the session and grant temporary ORBAT slot access.' }
          : { status: 'finished', label: 'Session Passed', description: 'Complete this training session.' },
        { status: 'failed', label: 'Session Failed', description: 'Record that the trainee did not pass the session.', destructive: true },
      ];
    case 'finished':
      return requiresOrbatQualification
        ? [{ status: 'needs_qualify', label: 'Enable ORBAT Qualification', description: 'Grant temporary slot access for a practical attempt.' }]
        : [];
    case 'needs_qualify':
      return [
        { status: 'qualified', label: 'Mark Qualified', description: 'Record a successful practical qualification.' },
        { status: 'failed', label: 'Mark Failed', description: 'Remove temporary slot access after an unsuccessful attempt.', destructive: true },
      ];
    case 'failed':
    case 'qualified':
      return requiresOrbatQualification
        ? [{ status: 'needs_qualify', label: 'Start New Qualification Attempt', description: 'Grant temporary slot access for another practical attempt.' }]
        : [];
    default:
      return [];
  }
}

export default function TrainingStatusActionPanel({
  requestId,
  status,
  requiresTrainingSession,
  requiresOrbatQualification,
  onSaved,
}: {
  requestId: number;
  status: string;
  requiresTrainingSession: boolean;
  requiresOrbatQualification: boolean;
  onSaved: () => void | Promise<void>;
}) {
  const { showError, showSuccess } = useToast();
  const actions = useMemo(
    () => getStatusActions(status, requiresTrainingSession, requiresOrbatQualification),
    [requiresOrbatQualification, requiresTrainingSession, status],
  );
  const [notes, setNotes] = useState('');
  const [savingStatus, setSavingStatus] = useState<string | null>(null);

  const applyStatus = async (action: StatusAction) => {
    if (action.destructive && !window.confirm(`${action.label}? This updates the trainee's access immediately.`)) {
      return;
    }

    setSavingStatus(action.status);
    try {
      const response = await fetch(`/api/training-requests/${requestId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: action.status,
          adminResponse: notes.trim() || null,
        }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || 'Failed to update training status');
      }

      setNotes('');
      showSuccess(`Training status updated to ${action.status.replaceAll('_', ' ')}`);
      await onSaved();
    } catch (error) {
      showError(error instanceof Error ? error.message : 'Failed to update training status');
    } finally {
      setSavingStatus(null);
    }
  };

  return (
    <section
      className="space-y-3 rounded-lg border p-4"
      style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)' }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-semibold" style={{ color: 'var(--foreground)' }}>Qualification Status</h2>
          <p className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
            Trainer-controlled progress and qualification decisions.
          </p>
        </div>
        <TrainingStatusBadge status={status} />
      </div>

      {actions.length > 0 ? (
        <>
          <div>
            <label htmlFor={`training-status-notes-${requestId}`} className="mb-1 block text-sm font-medium" style={{ color: 'var(--foreground)' }}>
              Notes or feedback
            </label>
            <textarea
              id={`training-status-notes-${requestId}`}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={3}
              maxLength={4000}
              placeholder="Optional feedback saved with the status change"
              className="w-full rounded-md border px-3 py-2 text-sm"
              style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
            />
          </div>
          <div className="space-y-2">
            {actions.map((action) => (
              <button
                key={action.status}
                type="button"
                disabled={savingStatus !== null}
                onClick={() => void applyStatus(action)}
                className="flex w-full items-center justify-between gap-3 rounded-md border px-3 py-2 text-left disabled:opacity-50"
                style={{
                  backgroundColor: action.destructive ? 'rgba(220, 38, 38, 0.08)' : 'var(--background)',
                  borderColor: action.destructive ? 'var(--destructive)' : 'var(--border)',
                  color: 'var(--foreground)',
                }}
              >
                <span>
                  <span className="block text-sm font-medium">{action.label}</span>
                  <span className="block text-xs" style={{ color: 'var(--muted-foreground)' }}>{action.description}</span>
                </span>
                {savingStatus === action.status && <LoadingSpinner size="sm" />}
              </button>
            ))}
          </div>
        </>
      ) : (
        <p className="rounded-md border p-3 text-sm" style={{ borderColor: 'var(--border)', color: 'var(--muted-foreground)' }}>
          No status actions are available from this state.
        </p>
      )}
    </section>
  );
}
