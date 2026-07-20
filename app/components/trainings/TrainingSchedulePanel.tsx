'use client';

import { useEffect, useMemo, useState } from 'react';
import LoadingSpinner from '@/app/components/ui/LoadingSpinner';
import { useToast } from '@/app/components/ui/ToastContainer';
import TrainingScheduleSummary from './TrainingScheduleSummary';
import type { TrainingRequestSession, TrainingRequestUser } from './training-request-types';

type TrainingSchedulePanelProps = {
  requestId: number;
  session: TrainingRequestSession | null;
  defaultDurationMinutes: number | null;
  onSaved: () => void | Promise<void>;
};

function localDateParts(value: string | null) {
  if (!value) return { date: '', time: '' };
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return { date: '', time: '' };

  const year = parsed.getFullYear();
  const month = `${parsed.getMonth() + 1}`.padStart(2, '0');
  const day = `${parsed.getDate()}`.padStart(2, '0');
  const hours = `${parsed.getHours()}`.padStart(2, '0');
  const minutes = `${parsed.getMinutes()}`.padStart(2, '0');
  return { date: `${year}-${month}-${day}`, time: `${hours}:${minutes}` };
}

export default function TrainingSchedulePanel({
  requestId,
  session,
  defaultDurationMinutes,
  onSaved,
}: TrainingSchedulePanelProps) {
  const { showError, showSuccess } = useToast();
  const initialParts = useMemo(() => localDateParts(session?.startsAt ?? null), [session?.startsAt]);
  const [staff, setStaff] = useState<TrainingRequestUser[]>([]);
  const [trainerId, setTrainerId] = useState(session?.trainer?.id?.toString() ?? '');
  const [date, setDate] = useState(initialParts.date);
  const [time, setTime] = useState(initialParts.time);
  const [duration, setDuration] = useState(
    String(session?.durationMinutes ?? defaultDurationMinutes ?? 120),
  );
  const [instructions, setInstructions] = useState(session?.instructions ?? '');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const parts = localDateParts(session?.startsAt ?? null);
    setTrainerId(session?.trainer?.id?.toString() ?? '');
    setDate(parts.date);
    setTime(parts.time);
    setDuration(String(session?.durationMinutes ?? defaultDurationMinutes ?? 120));
    setInstructions(session?.instructions ?? '');
  }, [defaultDurationMinutes, session]);

  useEffect(() => {
    let active = true;
    void fetch('/api/training-staff', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) return [];
        const payload = await response.json();
        return Array.isArray(payload) ? payload : Array.isArray(payload.staff) ? payload.staff : [];
      })
      .then((rows: unknown[]) => {
        if (!active) return;
        setStaff(
          rows
            .map((row) => row as Partial<TrainingRequestUser>)
            .filter((row) => typeof row.id === 'number')
            .map((row) => ({
              id: row.id as number,
              username: typeof row.username === 'string' ? row.username : null,
              avatarUrl: typeof row.avatarUrl === 'string' ? row.avatarUrl : null,
            }))
            .sort((left, right) => (left.username || '').localeCompare(right.username || '')),
        );
      })
      .catch(() => undefined);

    return () => {
      active = false;
    };
  }, []);

  const saveSchedule = async (confirm: boolean) => {
    if (!trainerId) {
      showError('Select an eligible trainer');
      return;
    }
    if (!date || !time) {
      showError('Choose a date and time');
      return;
    }

    const startsAt = new Date(`${date}T${time}`);
    if (Number.isNaN(startsAt.getTime())) {
      showError('Choose a valid date and time');
      return;
    }

    const durationMinutes = Number(duration);
    if (!Number.isInteger(durationMinutes) || durationMinutes <= 0) {
      showError('Duration must be a positive number of minutes');
      return;
    }

    setIsSaving(true);
    try {
      const response = await fetch(`/api/training-requests/${requestId}/schedule`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assignedTrainerId: Number(trainerId),
          startsAt: startsAt.toISOString(),
          durationMinutes,
          specialInstructions: instructions.trim() || null,
          confirm,
        }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || 'Failed to save training schedule');
      }

      showSuccess(confirm ? 'Training schedule confirmed' : 'Schedule draft saved');
      await onSaved();
    } catch (error) {
      showError(error instanceof Error ? error.message : 'Failed to save training schedule');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section
      className="space-y-4 rounded-lg border p-4"
      style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)' }}
    >
      <div>
        <h2 className="font-semibold" style={{ color: 'var(--foreground)' }}>Schedule Training</h2>
        <p className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
          The user sees the trainer and time only after you confirm the schedule.
        </p>
      </div>

      {session && <TrainingScheduleSummary session={session} revealTrainer compact />}

      <div>
        <label htmlFor="training-trainer" className="mb-1 block text-sm font-medium" style={{ color: 'var(--foreground)' }}>
          Assigned trainer
        </label>
        <select
          id="training-trainer"
          value={trainerId}
          onChange={(event) => setTrainerId(event.target.value)}
          className="w-full rounded-md border px-3 py-2 text-sm"
          style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
        >
          <option value="">Select a trainer…</option>
          {staff.map((user) => (
            <option key={user.id} value={user.id}>{user.username || `User ${user.id}`}</option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="training-date" className="mb-1 block text-sm font-medium" style={{ color: 'var(--foreground)' }}>Date</label>
          <input
            id="training-date"
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            className="w-full rounded-md border px-3 py-2 text-sm"
            style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
          />
        </div>
        <div>
          <label htmlFor="training-time" className="mb-1 block text-sm font-medium" style={{ color: 'var(--foreground)' }}>Time</label>
          <input
            id="training-time"
            type="time"
            value={time}
            onChange={(event) => setTime(event.target.value)}
            className="w-full rounded-md border px-3 py-2 text-sm"
            style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
          />
        </div>
      </div>

      <div>
        <label htmlFor="training-duration" className="mb-1 block text-sm font-medium" style={{ color: 'var(--foreground)' }}>
          Duration (minutes)
        </label>
        <input
          id="training-duration"
          type="number"
          min={1}
          value={duration}
          onChange={(event) => setDuration(event.target.value)}
          className="w-full rounded-md border px-3 py-2 text-sm"
          style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
        />
      </div>

      <div>
        <label htmlFor="training-instructions" className="mb-1 block text-sm font-medium" style={{ color: 'var(--foreground)' }}>
          Special instructions
        </label>
        <textarea
          id="training-instructions"
          value={instructions}
          onChange={(event) => setInstructions(event.target.value)}
          rows={3}
          className="w-full rounded-md border px-3 py-2 text-sm"
          style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
          placeholder="Optional scenarios, preparation, or meeting instructions"
        />
      </div>

      <div className="rounded-md border px-3 py-2 text-sm" style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }}>
        Server: <strong>Arma3 Training Server</strong>
      </div>

      <div className="flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={() => void saveSchedule(false)}
          disabled={isSaving}
          className="rounded-md border px-4 py-2 text-sm font-medium disabled:opacity-50"
          style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }}
        >
          Save Draft
        </button>
        <button
          type="button"
          onClick={() => void saveSchedule(true)}
          disabled={isSaving}
          className="inline-flex min-w-40 items-center justify-center rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
          style={{ backgroundColor: 'var(--primary)', color: 'var(--primary-foreground)' }}
        >
          {isSaving ? <LoadingSpinner size="sm" /> : 'Assign & Confirm'}
        </button>
      </div>
    </section>
  );
}
