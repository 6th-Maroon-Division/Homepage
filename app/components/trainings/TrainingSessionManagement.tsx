'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import LoadingSpinner from '@/app/components/ui/LoadingSpinner';
import TrainingSessionAttendeeManager from './TrainingSessionAttendeeManager';
import DualRingTimePicker from '@/app/components/ui/DualRingTimePicker';

const SESSION_STATUSES = [
  'proposed',
  'scheduled',
  'in_progress',
  'completed',
  'cancelled',
] as const;

type SessionStatus = (typeof SESSION_STATUSES)[number];

export type TrainingSessionManagementTraining = {
  id: number;
  name: string;
  duration: number | null;
  isActive: boolean;
  requiresTrainingSession: boolean;
};

export type TrainingSessionManagementCandidateRequest = {
  id: number;
  userId: number;
  trainingId: number;
  status: string;
  user: {
    id: number;
    username: string | null;
    avatarUrl?: string | null;
  };
  session?: { id: number } | null;
};

type TrainingSessionManagementProps = {
  trainings: TrainingSessionManagementTraining[];
  candidateRequests: TrainingSessionManagementCandidateRequest[];
  initialSessionId?: number | null;
};

type StaffUser = {
  id: number;
  username: string | null;
  avatarUrl?: string | null;
};

type SessionAttendee = {
  id: number;
  userId: number;
  status: string;
  user: StaffUser;
  trainingRequest: { id: number } | null;
};

type TrainingSession = {
  id: number;
  trainingId: number;
  trainerId: number | null;
  startsAt: string | null;
  durationMinutes: number | null;
  status: SessionStatus;
  specialInstructions: string | null;
  updatedAt: string;
  server: string;
  training: {
    id: number;
    name: string;
    isActive: boolean;
  };
  trainer: StaffUser | null;
  attendees: SessionAttendee[];
};

type Filters = {
  trainingId: string;
  trainerId: string;
  status: '' | SessionStatus;
  from: string;
  to: string;
};

type CreateDraft = {
  trainingId: string;
  trainerId: string;
  startsAt: string;
  durationMinutes: string;
  specialInstructions: string;
};

type EditDraft = {
  trainerId: string;
  startsAt: string;
  durationMinutes: string;
  specialInstructions: string;
  status: SessionStatus;
};

const EMPTY_FILTERS: Filters = {
  trainingId: '',
  trainerId: '',
  status: '',
  from: '',
  to: '',
};

const ALLOWED_SESSION_TRANSITIONS: Record<SessionStatus, readonly SessionStatus[]> = {
  proposed: ['proposed', 'scheduled', 'cancelled'],
  scheduled: ['scheduled', 'in_progress', 'cancelled'],
  in_progress: ['in_progress', 'completed', 'cancelled'],
  completed: [],
  cancelled: [],
};

const fieldClassName = 'w-full rounded-md border px-2.5 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60';
const fieldStyle = {
  backgroundColor: 'var(--background)',
  borderColor: 'var(--border)',
  color: 'var(--foreground)',
};

function isSessionStatus(value: unknown): value is SessionStatus {
  return typeof value === 'string' && (SESSION_STATUSES as readonly string[]).includes(value);
}

function statusLabel(status: SessionStatus): string {
  return status.replaceAll('_', ' ').replace(/^./, (character) => character.toUpperCase());
}

function staffLabel(staff: StaffUser): string {
  return staff.username || `User ${staff.id}`;
}

function formatDateTime(value: string | null): string {
  if (!value) return 'Date not set';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Invalid date';
  return parsed.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function toDateTimeLocal(value: string | null): string {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}T${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`;
}

function datePart(value: string): string {
  return value.split('T')[0] ?? '';
}

function timePart(value: string): string {
  return value.split('T')[1]?.slice(0, 5) ?? '';
}

function updateDateTimePart(value: string, next: { date?: string; time?: string }): string {
  const date = next.date ?? datePart(value);
  const time = next.time ?? timePart(value);
  return date || time ? `${date}T${time}` : '';
}

function parseDuration(value: string): number | null | undefined {
  if (!value.trim()) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 1440) return undefined;
  return parsed;
}

function errorMessage(payload: unknown, fallback: string): string {
  if (
    payload
    && typeof payload === 'object'
    && 'error' in payload
    && typeof payload.error === 'string'
  ) {
    return payload.error;
  }
  return fallback;
}

async function readJson(response: Response): Promise<unknown> {
  return response.json().catch(() => ({}));
}

function SessionStatusBadge({ status }: { status: SessionStatus }) {
  const isCancelled = status === 'cancelled';
  const isComplete = status === 'completed';
  return (
    <span
      className="inline-flex rounded-full border px-2 py-0.5 text-xs font-medium"
      style={{
        borderColor: isCancelled ? 'var(--destructive)' : 'var(--border)',
        backgroundColor: 'var(--background)',
        color: isCancelled
          ? 'var(--destructive)'
          : isComplete
            ? 'var(--primary)'
            : 'var(--foreground)',
      }}
    >
      {statusLabel(status)}
    </span>
  );
}

function SessionEditor({
  session,
  staff,
  isLoadingStaff,
  candidateRequests,
  onSaved,
}: {
  session: TrainingSession;
  staff: StaffUser[];
  isLoadingStaff: boolean;
  candidateRequests: TrainingSessionManagementCandidateRequest[];
  onSaved: (message: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState<EditDraft>({
    trainerId: session.trainerId?.toString() ?? '',
    startsAt: toDateTimeLocal(session.startsAt),
    durationMinutes: session.durationMinutes?.toString() ?? '',
    specialInstructions: session.specialInstructions ?? '',
    status: session.status,
  });
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  const isTerminal = ALLOWED_SESSION_TRANSITIONS[session.status].length === 0;
  const currentTrainerIsEligible = session.trainerId === null
    || staff.some((item) => item.id === session.trainerId);
  const statusOptions = session.training.isActive
    ? ALLOWED_SESSION_TRANSITIONS[session.status]
    : session.status === 'cancelled'
      ? []
      : ['cancelled'] as const;

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isTerminal) return;

    if (!statusOptions.includes(draft.status)) {
      setError(session.training.isActive
        ? 'Choose a valid next status.'
        : 'Inactive training sessions can only be cancelled.');
      return;
    }

    const trainerId = draft.trainerId ? Number(draft.trainerId) : null;
    if (draft.trainerId && (!Number.isInteger(trainerId) || Number(trainerId) < 1)) {
      setError('Select a valid trainer.');
      return;
    }

    const startsAt = draft.startsAt ? new Date(draft.startsAt) : null;
    if (startsAt && Number.isNaN(startsAt.getTime())) {
      setError('Choose a valid start date and time.');
      return;
    }
    if (['scheduled', 'in_progress', 'completed'].includes(draft.status) && (!trainerId || !startsAt)) {
      setError('Scheduled and active sessions require a trainer and start time.');
      return;
    }

    const durationMinutes = parseDuration(draft.durationMinutes);
    if (durationMinutes === undefined) {
      setError('Duration must be between 1 and 1440 minutes.');
      return;
    }

    if (draft.status === 'cancelled' && session.status !== 'cancelled') {
      const confirmed = window.confirm(
        `Cancel Session #${session.id}? Attendees will be notified.`,
      );
      if (!confirmed) return;
    }

    setIsSaving(true);
    setError('');
    try {
      const response = await fetch(`/api/training-sessions/${session.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: draft.status,
          trainerId,
          startsAt: startsAt?.toISOString() ?? null,
          durationMinutes,
          specialInstructions: draft.specialInstructions.trim() || null,
        }),
      });
      const payload = await readJson(response);
      if (!response.ok) {
        throw new Error(errorMessage(payload, 'Unable to update the training session.'));
      }
      await onSaved(
        draft.status === 'cancelled' ? 'Training session cancelled.' : 'Training session updated.',
      );
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to update the training session.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-4 border-t pt-4" style={{ borderColor: 'var(--border)' }}>
      <form onSubmit={save} className="space-y-3">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <label className="space-y-1 text-xs font-medium" style={{ color: 'var(--foreground)' }}>
            <span>Trainer</span>
            <select
              value={draft.trainerId}
              onChange={(event) => setDraft((current) => ({ ...current, trainerId: event.target.value }))}
              disabled={isTerminal || isSaving || isLoadingStaff}
              className={fieldClassName}
              style={fieldStyle}
            >
              <option value="">Unassigned</option>
              {!currentTrainerIsEligible && session.trainer && (
                <option value={session.trainer.id} disabled>
                  {staffLabel(session.trainer)} (no longer eligible)
                </option>
              )}
              {staff.map((item) => (
                <option key={item.id} value={item.id}>{staffLabel(item)}</option>
              ))}
            </select>
          </label>

          <div className="space-y-1 text-xs font-medium" style={{ color: 'var(--foreground)' }}>
            <span>Start date</span>
            <input
              type="date"
              value={datePart(draft.startsAt)}
              onChange={(event) => setDraft((current) => ({ ...current, startsAt: updateDateTimePart(current.startsAt, { date: event.target.value }) }))}
              disabled={isTerminal || isSaving}
              className={fieldClassName}
              style={fieldStyle}
            />
            <DualRingTimePicker
              id={`training-session-${session.id}-time`}
              label="Start time"
              value={timePart(draft.startsAt)}
              onChange={(time) => setDraft((current) => ({ ...current, startsAt: updateDateTimePart(current.startsAt, { time }) }))}
              disabled={isTerminal || isSaving}
            />
          </div>

          <label className="space-y-1 text-xs font-medium" style={{ color: 'var(--foreground)' }}>
            <span>Duration (minutes)</span>
            <input
              type="number"
              min={1}
              max={1440}
              value={draft.durationMinutes}
              onChange={(event) => setDraft((current) => ({ ...current, durationMinutes: event.target.value }))}
              disabled={isTerminal || isSaving}
              className={fieldClassName}
              style={fieldStyle}
            />
          </label>

          <label className="space-y-1 text-xs font-medium" style={{ color: 'var(--foreground)' }}>
            <span>Status</span>
            <select
              value={draft.status}
              onChange={(event) => {
                const nextStatus = event.target.value;
                if (isSessionStatus(nextStatus)) {
                  setDraft((current) => ({ ...current, status: nextStatus }));
                }
              }}
              disabled={isTerminal || isSaving}
              className={fieldClassName}
              style={fieldStyle}
            >
              {!statusOptions.includes(draft.status) && (
                <option value={draft.status} disabled>{statusLabel(draft.status)}</option>
              )}
              {statusOptions.map((status) => (
                <option key={status} value={status}>{statusLabel(status)}</option>
              ))}
            </select>
          </label>
        </div>

        <label className="block space-y-1 text-xs font-medium" style={{ color: 'var(--foreground)' }}>
          <span>Special instructions</span>
          <textarea
            value={draft.specialInstructions}
            onChange={(event) => setDraft((current) => ({ ...current, specialInstructions: event.target.value }))}
            disabled={isTerminal || isSaving}
            maxLength={4000}
            rows={2}
            className={fieldClassName}
            style={fieldStyle}
            placeholder="Optional preparation, scenario, or meeting instructions"
          />
        </label>

        {error && (
          <p
            role="alert"
            className="rounded-md border px-3 py-2 text-sm"
            style={{ borderColor: 'var(--destructive)', color: 'var(--destructive)' }}
          >
            {error}
          </p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
            {isTerminal
              ? 'This session is final and can no longer be edited.'
              : 'Only valid forward lifecycle states are available.'}
          </p>
          {!isTerminal && (
            <button
              type="submit"
              disabled={isSaving}
              className="rounded-md px-3 py-2 text-sm font-medium disabled:opacity-50"
              style={{
                backgroundColor: draft.status === 'cancelled' ? 'var(--destructive)' : 'var(--primary)',
                color: draft.status === 'cancelled' ? 'var(--destructive-foreground)' : 'var(--primary-foreground)',
              }}
            >
              {isSaving ? 'Saving…' : draft.status === 'cancelled' ? 'Cancel session' : 'Save changes'}
            </button>
          )}
        </div>
      </form>

      <TrainingSessionAttendeeManager
        sessionId={session.id}
        trainingId={session.trainingId}
        candidateRequests={candidateRequests}
        onChanged={() => onSaved('Attendee list updated.')}
      />
    </div>
  );
}

export default function TrainingSessionManagement({
  trainings,
  candidateRequests,
  initialSessionId = null,
}: TrainingSessionManagementProps) {
  const eligibleTrainings = useMemo(
    () => trainings.filter((training) => training.isActive && training.requiresTrainingSession),
    [trainings],
  );
  const initialTraining = eligibleTrainings[0];
  const [staff, setStaff] = useState<StaffUser[]>([]);
  const [sessions, setSessions] = useState<TrainingSession[]>([]);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState<Filters>(EMPTY_FILTERS);
  const [showCreate, setShowCreate] = useState(false);
  const [expandedSessionId, setExpandedSessionId] = useState<number | null>(initialSessionId);
  const [selectedAttendeeUserIds, setSelectedAttendeeUserIds] = useState<number[]>([]);
  const [createDraft, setCreateDraft] = useState<CreateDraft>({
    trainingId: initialTraining?.id.toString() ?? '',
    trainerId: '',
    startsAt: '',
    durationMinutes: initialTraining?.duration?.toString() ?? '',
    specialInstructions: '',
  });
  const [isLoadingSessions, setIsLoadingSessions] = useState(true);
  const [isLoadingStaff, setIsLoadingStaff] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [listError, setListError] = useState('');
  const [staffError, setStaffError] = useState('');
  const [createError, setCreateError] = useState('');
  const [notice, setNotice] = useState('');
  const initialScrollDoneRef = useRef(false);

  const loadSessions = useCallback(async (nextFilters: Filters, signal?: AbortSignal) => {
    setIsLoadingSessions(true);
    setListError('');
    try {
      const searchParams = new URLSearchParams();
      if (nextFilters.trainingId) searchParams.set('trainingId', nextFilters.trainingId);
      if (nextFilters.trainerId) searchParams.set('trainerId', nextFilters.trainerId);
      if (nextFilters.status) searchParams.set('status', nextFilters.status);
      if (nextFilters.from) {
        searchParams.set('from', new Date(`${nextFilters.from}T00:00:00`).toISOString());
      }
      if (nextFilters.to) {
        searchParams.set('to', new Date(`${nextFilters.to}T23:59:59.999`).toISOString());
      }

      const query = searchParams.toString();
      const response = await fetch(`/api/training-sessions${query ? `?${query}` : ''}`, {
        cache: 'no-store',
        signal,
      });
      const payload = await readJson(response);
      if (!response.ok) {
        throw new Error(errorMessage(payload, 'Unable to load training sessions.'));
      }
      if (!payload || typeof payload !== 'object' || !('sessions' in payload) || !Array.isArray(payload.sessions)) {
        throw new Error('The training session response was invalid.');
      }
      setSessions(payload.sessions as TrainingSession[]);
    } catch (loadError) {
      if (loadError instanceof DOMException && loadError.name === 'AbortError') return;
      setListError(loadError instanceof Error ? loadError.message : 'Unable to load training sessions.');
    } finally {
      if (!signal?.aborted) setIsLoadingSessions(false);
    }
  }, []);

  const loadStaff = useCallback(async (signal?: AbortSignal) => {
    setIsLoadingStaff(true);
    setStaffError('');
    try {
      const response = await fetch('/api/training-staff', { cache: 'no-store', signal });
      const payload = await readJson(response);
      if (!response.ok) {
        throw new Error(errorMessage(payload, 'Unable to load eligible trainers.'));
      }
      if (!payload || typeof payload !== 'object' || !('staff' in payload) || !Array.isArray(payload.staff)) {
        throw new Error('The training staff response was invalid.');
      }
      setStaff((payload.staff as StaffUser[]).sort((left, right) => staffLabel(left).localeCompare(staffLabel(right))));
    } catch (loadError) {
      if (loadError instanceof DOMException && loadError.name === 'AbortError') return;
      setStaffError(loadError instanceof Error ? loadError.message : 'Unable to load eligible trainers.');
    } finally {
      if (!signal?.aborted) setIsLoadingStaff(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadSessions(EMPTY_FILTERS, controller.signal);
    void loadStaff(controller.signal);
    return () => controller.abort();
  }, [loadSessions, loadStaff]);

  useEffect(() => {
    if (
      initialScrollDoneRef.current
      || !initialSessionId
      || !sessions.some((session) => session.id === initialSessionId)
    ) return;
    initialScrollDoneRef.current = true;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(`training-session-${initialSessionId}`)?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [initialSessionId, sessions]);

  useEffect(() => {
    if (!eligibleTrainings.length) return;
    const selectedTraining = eligibleTrainings.find(
      (training) => training.id === Number(createDraft.trainingId),
    );
    if (selectedTraining) return;
    const nextTraining = eligibleTrainings[0];
    setCreateDraft((current) => ({
      ...current,
      trainingId: nextTraining.id.toString(),
      durationMinutes: nextTraining.duration?.toString() ?? '',
    }));
    setSelectedAttendeeUserIds([]);
  }, [createDraft.trainingId, eligibleTrainings]);

  const availableCandidates = useMemo(() => {
    const trainingId = Number(createDraft.trainingId);
    const byUserId = new Map<number, TrainingSessionManagementCandidateRequest>();
    for (const request of candidateRequests) {
      if (
        request.trainingId !== trainingId
        || !['pending', 'approved', 'in_training'].includes(request.status)
        || request.session
      ) {
        continue;
      }
      const existing = byUserId.get(request.userId);
      if (!existing || request.id > existing.id) byUserId.set(request.userId, request);
    }
    return Array.from(byUserId.values()).sort((left, right) => (
      (left.user.username || `User ${left.userId}`)
        .localeCompare(right.user.username || `User ${right.userId}`)
    ));
  }, [candidateRequests, createDraft.trainingId]);

  const applyFilters = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (filters.from && filters.to && filters.from > filters.to) {
      setListError('The start of the date range must be before the end.');
      return;
    }
    setAppliedFilters(filters);
    void loadSessions(filters);
  };

  const clearFilters = () => {
    setFilters(EMPTY_FILTERS);
    setAppliedFilters(EMPTY_FILTERS);
    void loadSessions(EMPTY_FILTERS);
  };

  const refreshSessions = async (message?: string) => {
    if (message) setNotice(message);
    await loadSessions(appliedFilters);
  };

  const createSession = async (status: 'proposed' | 'scheduled') => {
    const trainingId = Number(createDraft.trainingId);
    const trainerId = Number(createDraft.trainerId);
    if (!Number.isInteger(trainingId) || trainingId < 1) {
      setCreateError('Select an active training that requires a session.');
      return;
    }
    if (!Number.isInteger(trainerId) || trainerId < 1) {
      setCreateError('Select an eligible trainer.');
      return;
    }

    const startsAt = createDraft.startsAt ? new Date(createDraft.startsAt) : null;
    if (startsAt && Number.isNaN(startsAt.getTime())) {
      setCreateError('Choose a valid start date and time.');
      return;
    }
    if (status === 'scheduled' && !startsAt) {
      setCreateError('A scheduled session requires a start date and time.');
      return;
    }

    const durationMinutes = parseDuration(createDraft.durationMinutes);
    if (durationMinutes === undefined) {
      setCreateError('Duration must be between 1 and 1440 minutes.');
      return;
    }

    const selectedCandidates = availableCandidates.filter((candidate) => (
      selectedAttendeeUserIds.includes(candidate.userId)
    ));
    if (status === 'scheduled' && selectedCandidates.some((candidate) => candidate.status === 'pending')) {
      setCreateError('Pending requests must be approved before their session can be scheduled.');
      return;
    }

    setIsCreating(true);
    setCreateError('');
    setNotice('');
    try {
      const response = await fetch('/api/training-sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          trainingId,
          trainerId,
          status,
          startsAt: startsAt?.toISOString() ?? null,
          ...(durationMinutes !== null ? { durationMinutes } : {}),
          specialInstructions: createDraft.specialInstructions.trim() || null,
          attendeeUserIds: selectedAttendeeUserIds,
        }),
      });
      const payload = await readJson(response);
      if (!response.ok) {
        throw new Error(errorMessage(payload, 'Unable to create the training session.'));
      }

      const createdId = payload && typeof payload === 'object' && 'id' in payload
        ? Number(payload.id)
        : null;
      setSelectedAttendeeUserIds([]);
      setCreateDraft((current) => ({
        ...current,
        startsAt: '',
        specialInstructions: '',
      }));
      setNotice(status === 'scheduled' ? 'Scheduled session created.' : 'Draft session created.');
      if (createdId && Number.isInteger(createdId)) setExpandedSessionId(createdId);
      await loadSessions(appliedFilters);
    } catch (createFailure) {
      setCreateError(
        createFailure instanceof Error ? createFailure.message : 'Unable to create the training session.',
      );
    } finally {
      setIsCreating(false);
    }
  };

  const handleTrainingChange = (trainingId: string) => {
    const training = eligibleTrainings.find((item) => item.id === Number(trainingId));
    setCreateDraft((current) => ({
      ...current,
      trainingId,
      durationMinutes: training?.duration?.toString() ?? '',
    }));
    setSelectedAttendeeUserIds([]);
    setCreateError('');
  };

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold" style={{ color: 'var(--foreground)' }}>
            Training Sessions
          </h2>
          <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>
            Schedule training-server sessions, move them through delivery, and manage attendance.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreate((current) => !current)}
          className="rounded-md px-3 py-2 text-sm font-medium"
          style={{ backgroundColor: 'var(--primary)', color: 'var(--primary-foreground)' }}
        >
          {showCreate ? 'Close form' : 'New session'}
        </button>
      </div>

      {notice && (
        <div
          role="status"
          className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm"
          style={{ borderColor: 'var(--primary)', color: 'var(--foreground)' }}
        >
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice('')} className="text-xs underline">
            Dismiss
          </button>
        </div>
      )}

      {staffError && (
        <p
          role="alert"
          className="rounded-md border px-3 py-2 text-sm"
          style={{ borderColor: 'var(--destructive)', color: 'var(--destructive)' }}
        >
          {staffError}{' '}
          <button type="button" onClick={() => void loadStaff()} className="underline">Retry</button>
        </p>
      )}

      {showCreate && (
        <div
          className="space-y-4 rounded-lg border p-4"
          style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)' }}
        >
          <div>
            <h3 className="font-semibold" style={{ color: 'var(--foreground)' }}>Create session</h3>
            <p className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
              A draft stays proposed. Scheduling confirms the trainer and time to attendees.
            </p>
          </div>

          {!eligibleTrainings.length ? (
            <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>
              No active training currently requires a training session.
            </p>
          ) : (
            <>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <label className="space-y-1 text-xs font-medium" style={{ color: 'var(--foreground)' }}>
                  <span>Training</span>
                  <select
                    value={createDraft.trainingId}
                    onChange={(event) => handleTrainingChange(event.target.value)}
                    disabled={isCreating}
                    className={fieldClassName}
                    style={fieldStyle}
                  >
                    {eligibleTrainings.map((training) => (
                      <option key={training.id} value={training.id}>{training.name}</option>
                    ))}
                  </select>
                </label>

                <label className="space-y-1 text-xs font-medium" style={{ color: 'var(--foreground)' }}>
                  <span>Trainer</span>
                  <select
                    value={createDraft.trainerId}
                    onChange={(event) => setCreateDraft((current) => ({ ...current, trainerId: event.target.value }))}
                    disabled={isCreating || isLoadingStaff}
                    className={fieldClassName}
                    style={fieldStyle}
                  >
                    <option value="">{isLoadingStaff ? 'Loading trainers…' : 'Select a trainer…'}</option>
                    {staff.map((item) => (
                      <option key={item.id} value={item.id}>{staffLabel(item)}</option>
                    ))}
                  </select>
                </label>

                <div className="space-y-1 text-xs font-medium" style={{ color: 'var(--foreground)' }}>
                  <span>Start date</span>
                  <input
                    type="date"
                    value={datePart(createDraft.startsAt)}
                    onChange={(event) => setCreateDraft((current) => ({ ...current, startsAt: updateDateTimePart(current.startsAt, { date: event.target.value }) }))}
                    disabled={isCreating}
                    className={fieldClassName}
                    style={fieldStyle}
                  />
                  <DualRingTimePicker
                    id="create-training-session-time"
                    label="Start time"
                    value={timePart(createDraft.startsAt)}
                    onChange={(time) => setCreateDraft((current) => ({ ...current, startsAt: updateDateTimePart(current.startsAt, { time }) }))}
                    disabled={isCreating}
                  />
                </div>

                <label className="space-y-1 text-xs font-medium" style={{ color: 'var(--foreground)' }}>
                  <span>Duration (minutes)</span>
                  <input
                    type="number"
                    min={1}
                    max={1440}
                    value={createDraft.durationMinutes}
                    onChange={(event) => setCreateDraft((current) => ({ ...current, durationMinutes: event.target.value }))}
                    disabled={isCreating}
                    placeholder="Training default"
                    className={fieldClassName}
                    style={fieldStyle}
                  />
                </label>
              </div>

              <label className="block space-y-1 text-xs font-medium" style={{ color: 'var(--foreground)' }}>
                <span>Special instructions</span>
                <textarea
                  value={createDraft.specialInstructions}
                  onChange={(event) => setCreateDraft((current) => ({ ...current, specialInstructions: event.target.value }))}
                  disabled={isCreating}
                  maxLength={4000}
                  rows={2}
                  className={fieldClassName}
                  style={fieldStyle}
                  placeholder="Optional preparation, scenario, or meeting instructions"
                />
              </label>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <h4 className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>
                    Initial attendees
                  </h4>
                  <span className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
                    {selectedAttendeeUserIds.length} selected
                  </span>
                </div>
                {availableCandidates.length ? (
                  <div className="grid max-h-44 gap-2 overflow-y-auto rounded-md border p-2 sm:grid-cols-2 xl:grid-cols-3" style={{ borderColor: 'var(--border)' }}>
                    {availableCandidates.map((candidate) => {
                      const selected = selectedAttendeeUserIds.includes(candidate.userId);
                      return (
                        <label
                          key={candidate.id}
                          className="flex cursor-pointer items-center gap-2 rounded-md border px-2 py-1.5 text-sm"
                          style={{
                            borderColor: selected ? 'var(--primary)' : 'var(--border)',
                            color: 'var(--foreground)',
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={selected}
                            disabled={isCreating}
                            onChange={() => setSelectedAttendeeUserIds((current) => (
                              current.includes(candidate.userId)
                                ? current.filter((id) => id !== candidate.userId)
                                : [...current, candidate.userId]
                            ))}
                          />
                          <span className="min-w-0 truncate">
                            {candidate.user.username || `User ${candidate.userId}`}
                            <span className="ml-1 text-xs" style={{ color: 'var(--muted-foreground)' }}>
                              · {candidate.status.replaceAll('_', ' ')}
                            </span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
                    No unassigned active requests for this training. Attendees can also be added later.
                  </p>
                )}
                <p className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
                  Pending requests can join a draft, but must be approved before the session is scheduled.
                </p>
              </div>

              {createError && (
                <p
                  role="alert"
                  className="rounded-md border px-3 py-2 text-sm"
                  style={{ borderColor: 'var(--destructive)', color: 'var(--destructive)' }}
                >
                  {createError}
                </p>
              )}

              <div className="flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  onClick={() => void createSession('proposed')}
                  disabled={isCreating || isLoadingStaff}
                  className="rounded-md border px-3 py-2 text-sm font-medium disabled:opacity-50"
                  style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }}
                >
                  {isCreating ? 'Saving…' : 'Save draft'}
                </button>
                <button
                  type="button"
                  onClick={() => void createSession('scheduled')}
                  disabled={isCreating || isLoadingStaff}
                  className="rounded-md px-3 py-2 text-sm font-medium disabled:opacity-50"
                  style={{ backgroundColor: 'var(--primary)', color: 'var(--primary-foreground)' }}
                >
                  {isCreating ? 'Saving…' : 'Create scheduled'}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      <form
        onSubmit={applyFilters}
        className="grid gap-2 rounded-lg border p-3 sm:grid-cols-2 lg:grid-cols-6"
        style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)' }}
      >
        <label className="space-y-1 text-xs font-medium" style={{ color: 'var(--foreground)' }}>
          <span>Training</span>
          <select
            value={filters.trainingId}
            onChange={(event) => setFilters((current) => ({ ...current, trainingId: event.target.value }))}
            className={fieldClassName}
            style={fieldStyle}
          >
            <option value="">All trainings</option>
            {trainings.map((training) => (
              <option key={training.id} value={training.id}>{training.name}</option>
            ))}
          </select>
        </label>

        <label className="space-y-1 text-xs font-medium" style={{ color: 'var(--foreground)' }}>
          <span>Trainer</span>
          <select
            value={filters.trainerId}
            onChange={(event) => setFilters((current) => ({ ...current, trainerId: event.target.value }))}
            disabled={isLoadingStaff}
            className={fieldClassName}
            style={fieldStyle}
          >
            <option value="">All trainers</option>
            {staff.map((item) => (
              <option key={item.id} value={item.id}>{staffLabel(item)}</option>
            ))}
          </select>
        </label>

        <label className="space-y-1 text-xs font-medium" style={{ color: 'var(--foreground)' }}>
          <span>Status</span>
          <select
            value={filters.status}
            onChange={(event) => {
              const status = event.target.value;
              setFilters((current) => ({
                ...current,
                status: isSessionStatus(status) ? status : '',
              }));
            }}
            className={fieldClassName}
            style={fieldStyle}
          >
            <option value="">All statuses</option>
            {SESSION_STATUSES.map((status) => (
              <option key={status} value={status}>{statusLabel(status)}</option>
            ))}
          </select>
        </label>

        <label className="space-y-1 text-xs font-medium" style={{ color: 'var(--foreground)' }}>
          <span>From</span>
          <input
            type="date"
            value={filters.from}
            onChange={(event) => setFilters((current) => ({ ...current, from: event.target.value }))}
            className={fieldClassName}
            style={fieldStyle}
          />
        </label>

        <label className="space-y-1 text-xs font-medium" style={{ color: 'var(--foreground)' }}>
          <span>To</span>
          <input
            type="date"
            value={filters.to}
            onChange={(event) => setFilters((current) => ({ ...current, to: event.target.value }))}
            className={fieldClassName}
            style={fieldStyle}
          />
        </label>

        <div className="flex items-end gap-2">
          <button
            type="submit"
            disabled={isLoadingSessions}
            className="flex-1 rounded-md px-3 py-2 text-sm font-medium disabled:opacity-50"
            style={{ backgroundColor: 'var(--primary)', color: 'var(--primary-foreground)' }}
          >
            Apply
          </button>
          <button
            type="button"
            onClick={clearFilters}
            disabled={isLoadingSessions}
            className="rounded-md border px-3 py-2 text-sm disabled:opacity-50"
            style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }}
            aria-label="Clear session filters"
          >
            Clear
          </button>
        </div>
      </form>

      <div className="flex items-center justify-between gap-3">
        <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>
          {isLoadingSessions ? 'Loading sessions…' : `${sessions.length} session${sessions.length === 1 ? '' : 's'}`}
        </p>
        <button
          type="button"
          onClick={() => void loadSessions(appliedFilters)}
          disabled={isLoadingSessions}
          className="rounded-md border px-3 py-1.5 text-xs disabled:opacity-50"
          style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }}
        >
          Refresh
        </button>
      </div>

      {listError && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
          style={{ borderColor: 'var(--destructive)', color: 'var(--destructive)' }}
        >
          <span>{listError}</span>
          <button type="button" onClick={() => void loadSessions(appliedFilters)} className="underline">
            Retry
          </button>
        </div>
      )}

      {isLoadingSessions && !sessions.length ? (
        <div className="flex min-h-40 items-center justify-center" style={{ color: 'var(--foreground)' }}>
          <LoadingSpinner size="md" />
        </div>
      ) : sessions.length ? (
        <div className="space-y-3">
          {sessions.map((session) => {
            const isExpanded = expandedSessionId === session.id;
            const attendeeNames = session.attendees
              .slice(0, 3)
              .map((attendee) => attendee.user.username || `User ${attendee.userId}`)
              .join(', ');
            return (
              <article
                key={session.id}
                id={`training-session-${session.id}`}
                className="rounded-lg border p-4"
                style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)' }}
              >
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold" style={{ color: 'var(--foreground)' }}>
                        {session.training.name}
                      </h3>
                      <SessionStatusBadge status={session.status} />
                      <span className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
                        #{session.id}
                      </span>
                    </div>
                    <p className="text-sm" style={{ color: 'var(--foreground)' }}>
                      {formatDateTime(session.startsAt)}
                      {session.durationMinutes ? ` · ${session.durationMinutes} min` : ''}
                      {` · ${session.trainer ? staffLabel(session.trainer) : 'No trainer'}`}
                    </p>
                    <p className="truncate text-xs" style={{ color: 'var(--muted-foreground)' }}>
                      {session.server || 'Arma3 Training Server'} · {session.attendees.length} attendee{session.attendees.length === 1 ? '' : 's'}
                      {attendeeNames ? ` · ${attendeeNames}${session.attendees.length > 3 ? ', …' : ''}` : ''}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setExpandedSessionId((current) => current === session.id ? null : session.id)}
                    className="self-start rounded-md border px-3 py-1.5 text-sm font-medium lg:self-auto"
                    style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }}
                    aria-expanded={isExpanded}
                  >
                    {isExpanded ? 'Close' : 'Manage'}
                  </button>
                </div>

                {session.specialInstructions && !isExpanded && (
                  <p className="mt-2 line-clamp-2 text-xs" style={{ color: 'var(--muted-foreground)' }}>
                    {session.specialInstructions}
                  </p>
                )}

                {isExpanded && (
                  <SessionEditor
                    key={`${session.id}:${session.updatedAt}`}
                    session={session}
                    staff={staff}
                    isLoadingStaff={isLoadingStaff}
                    candidateRequests={candidateRequests}
                    onSaved={refreshSessions}
                  />
                )}
              </article>
            );
          })}
        </div>
      ) : !listError ? (
        <div
          className="rounded-lg border px-4 py-10 text-center text-sm"
          style={{ borderColor: 'var(--border)', color: 'var(--muted-foreground)' }}
        >
          No training sessions match these filters.
        </div>
      ) : null}
    </section>
  );
}
