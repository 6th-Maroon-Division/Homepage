'use client';

import { useCallback, useEffect, useState } from 'react';
import LoadingSpinner from '@/app/components/ui/LoadingSpinner';
import { useToast } from '@/app/components/ui/ToastContainer';

type QualificationUser = {
  id: number;
  username: string | null;
  avatarUrl: string | null;
};

type AssignedSlot = {
  signupId: number;
  slotId: number;
  slotName: string;
  squadName: string;
};

type QualificationCandidate = {
  userTrainingId: number;
  user: QualificationUser;
  status: 'needs_qualify';
  notes: string | null;
  assignedSlot: AssignedSlot | null;
};

type QualificationGroup = {
  training: {
    id: number;
    name: string;
    qualificationNotes: string | null;
  };
  availableSlots: {
    id: number;
    label: string;
    remainingCapacity: number | null;
  }[];
  users: QualificationCandidate[];
};

type QualificationPayload = {
  groups: QualificationGroup[];
  total: number;
  orbatId?: number;
};

export default function OrbatQualificationPanel({ orbatId }: { orbatId: number }) {
  const { showError, showSuccess } = useToast();
  const [visibility, setVisibility] = useState<'checking' | 'hidden' | 'visible'>('checking');
  const [groups, setGroups] = useState<QualificationGroup[]>([]);
  const [notesById, setNotesById] = useState<Record<number, string>>({});
  const [openNoteId, setOpenNoteId] = useState<number | null>(null);
  const [selectedSlotById, setSelectedSlotById] = useState<Record<number, string>>({});
  const [assigningId, setAssigningId] = useState<number | null>(null);
  const [updating, setUpdating] = useState<{
    id: number;
    status: 'qualified' | 'failed';
  } | null>(null);

  const loadQualifications = useCallback(async () => {
    try {
      const response = await fetch(`/api/orbats/${orbatId}/qualifications`, {
        cache: 'no-store',
      });

      if (response.status === 401 || response.status === 403) {
        setVisibility('hidden');
        return;
      }
      if (!response.ok) {
        throw new Error('Unable to load ORBAT qualifications');
      }

      const payload = (await response.json()) as QualificationPayload;
      const nextGroups = Array.isArray(payload.groups) ? payload.groups : [];
      setGroups(nextGroups);
      setNotesById((current) => {
        const next = { ...current };
        for (const group of nextGroups) {
          for (const candidate of group.users) {
            if (!(candidate.userTrainingId in next)) {
              next[candidate.userTrainingId] = candidate.notes ?? '';
            }
          }
        }
        return next;
      });
      setVisibility('visible');
    } catch {
      // The endpoint is intentionally staff-only. Avoid exposing a partial
      // management surface when access or loading cannot be confirmed.
      setVisibility('hidden');
    }
  }, [orbatId]);

  useEffect(() => {
    void loadQualifications();
  }, [loadQualifications]);

  useEffect(() => {
    if (visibility !== 'visible') return;
    const interval = setInterval(() => void loadQualifications(), 30_000);
    return () => clearInterval(interval);
  }, [loadQualifications, visibility]);

  const decideQualification = async (
    candidate: QualificationCandidate,
    trainingName: string,
    status: 'qualified' | 'failed',
  ) => {
    setUpdating({ id: candidate.userTrainingId, status });
    try {
      const response = await fetch(`/api/orbats/${orbatId}/qualifications`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userTrainingId: candidate.userTrainingId,
          status,
          notes: notesById[candidate.userTrainingId] ?? '',
        }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || `Unable to mark qualification as ${status}`);
      }

      showSuccess(
        status === 'qualified'
          ? `${candidate.user.username || 'User'} qualified for ${trainingName}`
          : `${candidate.user.username || 'User'} marked as failed for ${trainingName}`,
      );
      setOpenNoteId(null);
      await loadQualifications();
    } catch (error) {
      showError(error instanceof Error ? error.message : 'Unable to update qualification');
    } finally {
      setUpdating(null);
    }
  };

  const assignForEvaluation = async (candidate: QualificationCandidate) => {
    const targetSlotId = Number(selectedSlotById[candidate.userTrainingId]);
    if (!Number.isInteger(targetSlotId) || targetSlotId <= 0) {
      showError('Select an available qualification slot');
      return;
    }

    setAssigningId(candidate.userTrainingId);
    try {
      const response = await fetch(`/api/orbats/${orbatId}/qualifications/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userTrainingId: candidate.userTrainingId,
          targetSlotId,
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || 'Unable to assign qualification slot');
      }

      showSuccess(`${candidate.user.username || 'User'} assigned for qualification`);
      await loadQualifications();
    } catch (error) {
      showError(error instanceof Error ? error.message : 'Unable to assign qualification slot');
    } finally {
      setAssigningId(null);
    }
  };

  if (visibility !== 'visible') return null;

  return (
    <section
      className="rounded-lg border p-4 space-y-4"
      style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)' }}
      aria-labelledby="orbat-qualifications-title"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id="orbat-qualifications-title" className="text-lg font-semibold" style={{ color: 'var(--foreground)' }}>
            Users Needing Qualification
          </h2>
          <p className="mt-1 text-xs" style={{ color: 'var(--muted-foreground)' }}>
            Record practical qualification results for trainings used by this ORBAT.
          </p>
        </div>
        <span
          className="rounded-full px-2.5 py-1 text-xs font-semibold"
          style={{ backgroundColor: '#ea580c', color: '#ffffff' }}
        >
          {groups.reduce((total, group) => total + group.users.length, 0)} pending
        </span>
      </div>

      {groups.length === 0 ? (
        <div
          className="rounded-md border p-4 text-sm"
          style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)', color: 'var(--muted-foreground)' }}
        >
          No users currently need qualification for this ORBAT.
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map((group) => (
            <article
              key={group.training.id}
              className="rounded-md border p-3"
              style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)' }}
            >
              <div className="mb-3">
                <h3 className="font-semibold" style={{ color: 'var(--foreground)' }}>
                  {group.training.name}
                  <span className="ml-2 text-xs font-normal" style={{ color: 'var(--muted-foreground)' }}>
                    ({group.users.length})
                  </span>
                </h3>
                {group.training.qualificationNotes && (
                  <p className="mt-1 text-xs" style={{ color: 'var(--muted-foreground)' }}>
                    {group.training.qualificationNotes}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                {group.users.map((candidate) => {
                  const isUpdating = updating?.id === candidate.userTrainingId;
                  const noteIsOpen = openNoteId === candidate.userTrainingId;
                  return (
                    <div
                      key={candidate.userTrainingId}
                      className="rounded-md border p-3"
                      style={{ borderColor: 'var(--border)', backgroundColor: 'var(--secondary)' }}
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <div className="font-medium" style={{ color: 'var(--foreground)' }}>
                            {candidate.user.username || `User #${candidate.user.id}`}
                          </div>
                          <div className="mt-0.5 text-xs" style={{ color: 'var(--muted-foreground)' }}>
                            {candidate.assignedSlot
                              ? `Assigned to ${candidate.assignedSlot.squadName} — ${candidate.assignedSlot.slotName}`
                              : 'Not assigned to a relevant slot'}
                          </div>
                          <span
                            className="mt-2 inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold"
                            style={{ backgroundColor: '#ea580c', color: '#ffffff' }}
                          >
                            Qualification pending
                          </span>
                          {!candidate.assignedSlot && (
                            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                              <label htmlFor={`qualification-slot-${candidate.userTrainingId}`} className="sr-only">
                                Qualification slot
                              </label>
                              <select
                                id={`qualification-slot-${candidate.userTrainingId}`}
                                value={selectedSlotById[candidate.userTrainingId] ?? ''}
                                onChange={(event) => setSelectedSlotById((current) => ({
                                  ...current,
                                  [candidate.userTrainingId]: event.target.value,
                                }))}
                                disabled={assigningId === candidate.userTrainingId}
                                className="min-w-0 flex-1 rounded-md border px-2 py-1.5 text-xs"
                                style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
                              >
                                <option value="">Select evaluation slot…</option>
                                {group.availableSlots.map((slot) => (
                                  <option key={slot.id} value={slot.id}>
                                    {slot.label}{slot.remainingCapacity === null ? '' : ` (${slot.remainingCapacity} open)`}
                                  </option>
                                ))}
                              </select>
                              <button
                                type="button"
                                onClick={() => void assignForEvaluation(candidate)}
                                disabled={assigningId === candidate.userTrainingId || !selectedSlotById[candidate.userTrainingId]}
                                className="inline-flex items-center justify-center gap-1 rounded-md border px-3 py-1.5 text-xs font-medium disabled:opacity-50"
                                style={{ borderColor: 'var(--primary)', color: 'var(--primary)' }}
                              >
                                {assigningId === candidate.userTrainingId ? <LoadingSpinner size="sm" /> : null}
                                Assign to Slot
                              </button>
                            </div>
                          )}
                        </div>

                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => setOpenNoteId(noteIsOpen ? null : candidate.userTrainingId)}
                            disabled={isUpdating}
                            className="rounded-md border px-3 py-1.5 text-xs font-medium disabled:opacity-50"
                            style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }}
                          >
                            {candidate.notes || notesById[candidate.userTrainingId] ? 'Edit Note' : 'Add Note'}
                          </button>
                          <button
                            type="button"
                            onClick={() => void decideQualification(candidate, group.training.name, 'qualified')}
                            disabled={isUpdating}
                            className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
                            style={{ backgroundColor: '#16a34a', color: '#ffffff' }}
                          >
                            {isUpdating && updating.status === 'qualified' ? <LoadingSpinner size="sm" /> : null}
                            Qualify
                          </button>
                          <button
                            type="button"
                            onClick={() => void decideQualification(candidate, group.training.name, 'failed')}
                            disabled={isUpdating}
                            className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
                            style={{ backgroundColor: 'var(--destructive)', color: 'var(--destructive-foreground)' }}
                          >
                            {isUpdating && updating.status === 'failed' ? <LoadingSpinner size="sm" /> : null}
                            Fail
                          </button>
                        </div>
                      </div>

                      {noteIsOpen && (
                        <div className="mt-3">
                          <label
                            htmlFor={`qualification-note-${candidate.userTrainingId}`}
                            className="mb-1 block text-xs font-medium"
                            style={{ color: 'var(--foreground)' }}
                          >
                            Performance feedback
                          </label>
                          <textarea
                            id={`qualification-note-${candidate.userTrainingId}`}
                            value={notesById[candidate.userTrainingId] ?? ''}
                            onChange={(event) =>
                              setNotesById((current) => ({
                                ...current,
                                [candidate.userTrainingId]: event.target.value,
                              }))
                            }
                            maxLength={4000}
                            rows={3}
                            placeholder="Add observations to save with the qualification result…"
                            className="w-full rounded-md border px-3 py-2 text-sm"
                            style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
                          />
                          <p className="mt-1 text-[11px]" style={{ color: 'var(--muted-foreground)' }}>
                            This feedback is saved when you choose Qualify or Fail.
                          </p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
