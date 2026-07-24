import type { TrainingRequestSession } from './training-request-types';

export const TRAINING_SERVER_NAME = 'Arma3 Training Server';

function getSessionEnd(session: TrainingRequestSession): Date | null {
  if (session.endsAt) {
    const end = new Date(session.endsAt);
    return Number.isNaN(end.getTime()) ? null : end;
  }

  if (session.startsAt && session.durationMinutes) {
    const start = new Date(session.startsAt);
    if (!Number.isNaN(start.getTime())) {
      return new Date(start.getTime() + session.durationMinutes * 60_000);
    }
  }

  return null;
}

export function isConfirmedTrainingSession(session: TrainingRequestSession | null): boolean {
  if (!session) return false;
  return Boolean(session.confirmedAt) || ['scheduled', 'in_progress', 'completed'].includes(session.status);
}

export default function TrainingScheduleSummary({
  session,
  revealTrainer,
  compact = false,
}: {
  session: TrainingRequestSession;
  revealTrainer: boolean;
  compact?: boolean;
}) {
  const start = session.startsAt ? new Date(session.startsAt) : null;
  const validStart = start && !Number.isNaN(start.getTime()) ? start : null;
  const end = getSessionEnd(session);

  return (
    <section
      className={`rounded-lg border ${compact ? 'p-3' : 'p-4'}`}
      style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)' }}
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold" style={{ color: 'var(--foreground)' }}>
          {isConfirmedTrainingSession(session) ? 'Training Scheduled' : 'Schedule Draft'}
        </h2>
        <span
          className="rounded-full px-2 py-1 text-xs font-medium"
          style={{
            backgroundColor: isConfirmedTrainingSession(session) ? '#16a34a' : '#d97706',
            color: '#ffffff',
          }}
        >
          {isConfirmedTrainingSession(session) ? 'Confirmed' : 'Not confirmed'}
        </span>
      </div>

      <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
        {revealTrainer && (
          <div>
            <dt className="text-xs" style={{ color: 'var(--muted-foreground)' }}>Trainer</dt>
            <dd className="font-medium" style={{ color: 'var(--foreground)' }}>
              {session.trainer?.username || 'Not assigned'}
            </dd>
          </div>
        )}
        <div>
          <dt className="text-xs" style={{ color: 'var(--muted-foreground)' }}>Date</dt>
          <dd className="font-medium" style={{ color: 'var(--foreground)' }}>
            {validStart ? validStart.toLocaleDateString([], { dateStyle: 'full' }) : 'Not set'}
          </dd>
        </div>
        <div>
          <dt className="text-xs" style={{ color: 'var(--muted-foreground)' }}>Time</dt>
          <dd className="font-medium" style={{ color: 'var(--foreground)' }}>
            {validStart
              ? `${validStart.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}${
                  end ? ` – ${end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''
                }`
              : 'Not set'}
          </dd>
        </div>
        <div>
          <dt className="text-xs" style={{ color: 'var(--muted-foreground)' }}>Server</dt>
          <dd className="font-medium" style={{ color: 'var(--foreground)' }}>{TRAINING_SERVER_NAME}</dd>
        </div>
      </dl>

      {session.instructions && (
        <div className="mt-3 rounded-md p-3 text-sm" style={{ backgroundColor: 'var(--muted)', color: 'var(--foreground)' }}>
          <div className="mb-1 text-xs font-semibold" style={{ color: 'var(--muted-foreground)' }}>
            Special instructions
          </div>
          <p className="whitespace-pre-wrap">{session.instructions}</p>
        </div>
      )}
    </section>
  );
}
