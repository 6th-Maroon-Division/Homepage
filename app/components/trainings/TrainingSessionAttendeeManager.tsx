'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import LoadingSpinner from '@/app/components/ui/LoadingSpinner';

type AttendanceStatus = 'scheduled' | 'attended' | 'completed' | 'absent' | 'cancelled';

type Attendee = {
  id: number;
  userId: number;
  status: AttendanceStatus;
  notes: string | null;
  updatedAt: string;
  attendedAt: string | null;
  completedAt: string | null;
  user: { id: number; username: string | null; avatarUrl?: string | null };
  trainingRequest: { id: number; status?: string } | null;
};

type CandidateRequest = {
  id: number;
  userId: number;
  trainingId: number;
  status: string;
  user: { id: number; username: string | null; avatarUrl?: string | null };
  session?: { id: number } | null;
};

type SessionPayload = {
  id: number;
  status: string;
  attendees: Attendee[];
};

type TrainingUser = {
  id: number;
  username: string | null;
  avatarUrl?: string | null;
  isTrainer: boolean;
};

const ATTENDANCE_OPTIONS: Array<{ value: AttendanceStatus; label: string }> = [
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'attended', label: 'Attended' },
  { value: 'completed', label: 'Completed' },
  { value: 'absent', label: 'Absent' },
  { value: 'cancelled', label: 'Cancelled' },
];

export default function TrainingSessionAttendeeManager({
  sessionId,
  trainingId,
  candidateRequests = [],
  onChanged,
}: {
  sessionId: number;
  trainingId: number;
  candidateRequests?: CandidateRequest[];
  onChanged?: () => void | Promise<void>;
}) {
  const [trainingSession, setTrainingSession] = useState<SessionPayload | null>(null);
  const [drafts, setDrafts] = useState<Record<number, { status: AttendanceStatus; notes: string }>>({});
  const [selectedCandidate, setSelectedCandidate] = useState('');
  const [trainingUsers, setTrainingUsers] = useState<TrainingUser[]>([]);
  const [advanceTraining, setAdvanceTraining] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const loadSession = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetch(`/api/training-sessions/${sessionId}`, { cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Unable to load session attendees');
      const nextSession = payload as SessionPayload;
      const nextDrafts: Record<number, { status: AttendanceStatus; notes: string }> = {};
      for (const attendee of nextSession.attendees || []) {
        nextDrafts[attendee.id] = {
          status: attendee.status,
          notes: attendee.notes || '',
        };
      }
      setTrainingSession(nextSession);
      setDrafts(nextDrafts);
      setError('');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load session attendees');
    } finally {
      setIsLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  useEffect(() => {
    void fetch('/api/training-users', { cache: 'no-store' })
      .then(async (response) => response.ok ? response.json() : { users: [] })
      .then((payload) => setTrainingUsers(Array.isArray(payload.users) ? payload.users : []))
      .catch(() => setTrainingUsers([]));
  }, []);

  const availableRequests = useMemo(() => {
    const attendeeUserIds = new Set((trainingSession?.attendees || []).map((attendee) => attendee.userId));
    return candidateRequests
      .filter((item) => item.trainingId === trainingId)
      .filter((item) => ['pending', 'approved', 'in_training'].includes(item.status))
      .filter((item) => !item.session && !attendeeUserIds.has(item.userId))
      .filter((item) => trainingSession?.status === 'proposed' || item.status !== 'pending')
      .sort((left, right) => (left.user.username || '').localeCompare(right.user.username || ''));
  }, [candidateRequests, trainingId, trainingSession]);

  const groupedUsers = useMemo(() => {
    const unavailableUserIds = new Set((trainingSession?.attendees || []).map((attendee) => attendee.userId));
    const requestedUserIds = new Set(availableRequests.map((request) => request.userId));
    const available = trainingUsers.filter((user) => !unavailableUserIds.has(user.id) && !requestedUserIds.has(user.id));
    return {
      trainers: available.filter((user) => user.isTrainer),
      others: available.filter((user) => !user.isTrainer),
    };
  }, [availableRequests, trainingSession, trainingUsers]);
  const selectedHasActiveRequest = selectedCandidate.startsWith('request:');

  const refreshAfterChange = async () => {
    await loadSession();
    await onChanged?.();
  };

  const addAttendee = async () => {
    const [candidateType, candidateIdText] = selectedCandidate.split(':');
    const candidateId = Number(candidateIdText);
    const selectedRequest = candidateType === 'request'
      ? availableRequests.find((item) => item.id === candidateId)
      : null;
    const userId = selectedRequest?.userId ?? (candidateType === 'user' ? candidateId : null);
    if (!userId) {
      setError('Select a user to add.');
      return;
    }

    setBusyKey('add');
    setError('');
    setNotice('');
    try {
      const response = await fetch(`/api/training-sessions/${sessionId}/attendees`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          ...(selectedRequest ? { trainingRequestId: selectedRequest.id } : {}),
          advanceTraining,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Unable to add attendee');
      setSelectedCandidate('');
      setAdvanceTraining(false);
      setNotice('Attendee added.');
      await refreshAfterChange();
    } catch (addError) {
      setError(addError instanceof Error ? addError.message : 'Unable to add attendee');
    } finally {
      setBusyKey(null);
    }
  };

  const saveAttendee = async (attendee: Attendee) => {
    const draft = drafts[attendee.id];
    if (!draft) return;
    setBusyKey(`save-${attendee.id}`);
    setError('');
    setNotice('');
    try {
      const response = await fetch(`/api/training-sessions/${sessionId}/attendees/${attendee.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: draft.status,
          notes: draft.notes.trim() || null,
          expectedUpdatedAt: attendee.updatedAt,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Unable to update attendee');
      setNotice('Attendance updated. Qualification status was not changed.');
      await refreshAfterChange();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to update attendee');
      if (saveError instanceof Error && saveError.message.toLowerCase().includes('refresh')) {
        await loadSession();
      }
    } finally {
      setBusyKey(null);
    }
  };

  const removeAttendee = async (attendee: Attendee) => {
    if (!window.confirm(`Remove ${attendee.user.username || `User ${attendee.userId}`} from this session?`)) return;
    setBusyKey(`remove-${attendee.id}`);
    setError('');
    setNotice('');
    try {
      const response = await fetch(`/api/training-sessions/${sessionId}/attendees/${attendee.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedUpdatedAt: attendee.updatedAt }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Unable to remove attendee');
      setNotice('Attendee removed and retained as cancelled for audit.');
      await refreshAfterChange();
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : 'Unable to remove attendee');
    } finally {
      setBusyKey(null);
    }
  };

  if (isLoading && !trainingSession) {
    return (
      <div className="flex min-h-24 items-center justify-center">
        <LoadingSpinner size="sm" />
      </div>
    );
  }

  return (
    <section className="space-y-3 rounded-lg border p-3" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--background)' }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-semibold" style={{ color: 'var(--foreground)' }}>Session attendees</h3>
          <p className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
            Session #{sessionId} · {trainingSession?.status?.replaceAll('_', ' ') || 'unknown'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadSession()}
          disabled={isLoading || busyKey !== null}
          className="rounded border px-2.5 py-1 text-xs disabled:opacity-50"
          style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }}
        >
          Refresh
        </button>
      </div>

      {error && (
        <p className="rounded border p-2 text-sm" style={{ borderColor: 'var(--destructive)', color: 'var(--destructive)' }}>
          {error}
        </p>
      )}
      {notice && (
        <p className="rounded border p-2 text-sm" style={{ borderColor: 'var(--primary)', color: 'var(--foreground)' }}>
          {notice}
        </p>
      )}

      <div className="space-y-2">
        {(trainingSession?.attendees || []).map((attendee) => {
          const draft = drafts[attendee.id] || { status: attendee.status, notes: attendee.notes || '' };
          const isBusy = busyKey === `save-${attendee.id}` || busyKey === `remove-${attendee.id}`;
          return (
            <div key={attendee.id} className="rounded-md border p-2.5" style={{ borderColor: 'var(--border)' }}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium" style={{ color: 'var(--foreground)' }}>
                    {attendee.user.username || `User ${attendee.userId}`}
                  </div>
                  <div className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
                    {attendee.trainingRequest ? (
                      <Link
                        href={`/trainings/requests/${attendee.trainingRequest.id}`}
                        className="underline"
                        style={{ color: 'var(--primary)' }}
                      >
                        Request #{attendee.trainingRequest.id} · open chat
                      </Link>
                    ) : 'No linked request'}
                  </div>
                </div>
                <select
                  aria-label={`Attendance status for ${attendee.user.username || attendee.userId}`}
                  value={draft.status}
                  onChange={(event) => setDrafts((current) => ({
                    ...current,
                    [attendee.id]: { ...draft, status: event.target.value as AttendanceStatus },
                  }))}
                  disabled={isBusy}
                  className="rounded border px-2 py-1 text-xs"
                  style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
                >
                  {ATTENDANCE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>
              <textarea
                value={draft.notes}
                onChange={(event) => setDrafts((current) => ({
                  ...current,
                  [attendee.id]: { ...draft, notes: event.target.value },
                }))}
                disabled={isBusy}
                placeholder="Attendance notes"
                rows={2}
                className="mt-2 w-full rounded border px-2 py-1.5 text-xs"
                style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
              />
              <div className="mt-2 flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  onClick={() => void removeAttendee(attendee)}
                  disabled={isBusy || attendee.status === 'cancelled'}
                  className="rounded border px-2.5 py-1 text-xs disabled:opacity-50"
                  style={{ borderColor: 'var(--destructive)', color: 'var(--destructive)' }}
                >
                  Remove
                </button>
                <button
                  type="button"
                  onClick={() => void saveAttendee(attendee)}
                  disabled={isBusy}
                  className="rounded px-2.5 py-1 text-xs font-medium disabled:opacity-50"
                  style={{ backgroundColor: 'var(--primary)', color: 'var(--primary-foreground)' }}
                >
                  Save
                </button>
              </div>
            </div>
          );
        })}
        {!trainingSession?.attendees?.length && (
          <p className="py-2 text-center text-sm" style={{ color: 'var(--muted-foreground)' }}>No attendees yet.</p>
        )}
      </div>

      {!['completed', 'cancelled'].includes(trainingSession?.status || '') && (
        <div className="space-y-2 border-t pt-3" style={{ borderColor: 'var(--border)' }}>
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
            <select
              aria-label="User to add to training session"
              value={selectedCandidate}
              onChange={(event) => {
                const value = event.target.value;
                setSelectedCandidate(value);
                if (!value.startsWith('request:')) setAdvanceTraining(false);
              }}
              className="min-w-0 rounded border px-2 py-1.5 text-xs"
              style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
            >
              <option value="">Select a user…</option>
              <optgroup label="Users with active requests">
                {availableRequests.map((item) => (
                  <option key={`request-${item.id}`} value={`request:${item.id}`}>
                    {item.user.username || `User ${item.userId}`} · {item.status.replaceAll('_', ' ')}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Eligible trainers">
                {groupedUsers.trainers.map((user) => (
                  <option key={`trainer-${user.id}`} value={`user:${user.id}`}>{user.username || `User ${user.id}`}</option>
                ))}
              </optgroup>
              <optgroup label="Other users">
                {groupedUsers.others.map((user) => (
                  <option key={`user-${user.id}`} value={`user:${user.id}`}>{user.username || `User ${user.id}`}</option>
                ))}
              </optgroup>
            </select>
            <button
              type="button"
              onClick={() => void addAttendee()}
              disabled={busyKey !== null || !selectedCandidate}
              className="rounded px-3 py-1.5 text-xs font-medium disabled:opacity-50"
              style={{ backgroundColor: 'var(--accent)', color: 'var(--accent-foreground)' }}
            >
              Add
            </button>
          </div>
          <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--foreground)' }}>
            <input
              type="checkbox"
              checked={advanceTraining}
              disabled={!selectedHasActiveRequest}
              onChange={(event) => setAdvanceTraining(event.target.checked)}
            />
            Advance this user&apos;s training to the next workflow step
          </label>
          {!selectedHasActiveRequest && selectedCandidate && (
            <p className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
              Training can only be advanced when the user has an active request for this training.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
