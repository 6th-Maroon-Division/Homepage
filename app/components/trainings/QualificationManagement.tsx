'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import LoadingSpinner from '@/app/components/ui/LoadingSpinner';
import { useToast } from '@/app/components/ui/ToastContainer';
import TrainingStatusBadge from './TrainingStatusBadge';

const USER_TRAINING_STATUSES = [
  'approved',
  'in_training',
  'finished',
  'needs_qualify',
  'qualified',
  'failed',
] as const;

type UserTrainingStatus = (typeof USER_TRAINING_STATUSES)[number];
type QualificationActionStatus = 'qualified' | 'failed' | 'needs_qualify';

type QualificationRecord = {
  id: number;
  userId: number;
  trainingId: number;
  status: UserTrainingStatus;
  statusUpdatedAt: string;
  assignedAt: string;
  isHidden: boolean;
  notes: string | null;
  needsRetraining: boolean;
  user: {
    id: number;
    username: string | null;
    avatarUrl: string | null;
  };
  training: {
    id: number;
    name: string;
    requiresTrainingSession: boolean;
    requiresOrbatQualification: boolean;
    orbatQualificationNotes: string | null;
  };
  trainer: {
    id: number;
    username: string | null;
    avatarUrl: string | null;
  } | null;
};

type QualificationAction = {
  status: QualificationActionStatus;
  label: string;
  destructive?: boolean;
};

function getIndividualActions(record: QualificationRecord): QualificationAction[] {
  switch (record.status) {
    case 'approved':
      return [
        ...(!record.training.requiresTrainingSession && record.training.requiresOrbatQualification
          ? [{ status: 'needs_qualify' as const, label: 'Needs qualification' }]
          : []),
        ...(!record.training.requiresTrainingSession && !record.training.requiresOrbatQualification
          ? [{ status: 'qualified' as const, label: 'Qualified' }]
          : []),
        { status: 'failed', label: 'Failed', destructive: true },
      ];
    case 'in_training':
      return [
        ...(record.training.requiresOrbatQualification
          ? [{ status: 'needs_qualify' as const, label: 'Needs qualification' }]
          : []),
        { status: 'failed', label: 'Failed', destructive: true },
      ];
    case 'needs_qualify':
      return [
        { status: 'qualified', label: 'Qualified' },
        { status: 'failed', label: 'Failed', destructive: true },
      ];
    case 'failed':
    case 'finished':
    case 'qualified':
      return record.training.requiresOrbatQualification
        ? [{ status: 'needs_qualify', label: 'Needs qualification' }]
        : [];
  }
}

function formatStatus(status: string) {
  return status.replaceAll('_', ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}

async function readResponsePayload(response: Response): Promise<Record<string, unknown>> {
  const payload = await response.json().catch(() => ({}));
  return payload && typeof payload === 'object' && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : {};
}

export default function QualificationManagement() {
  const { showError, showSuccess } = useToast();
  const [records, setRecords] = useState<QualificationRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [userFilter, setUserFilter] = useState('');
  const [trainingFilter, setTrainingFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [notesByRecordId, setNotesByRecordId] = useState<Record<number, string>>({});
  const [savingRecordId, setSavingRecordId] = useState<number | null>(null);
  const [recordErrors, setRecordErrors] = useState<Record<number, string>>({});
  const [bulkTrainingId, setBulkTrainingId] = useState('');
  const [selectedRecordIds, setSelectedRecordIds] = useState<Set<number>>(() => new Set());
  const [bulkNotes, setBulkNotes] = useState('');
  const [isBulkSaving, setIsBulkSaving] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setFetchError(null);
    try {
      const response = await fetch('/api/user-trainings?all=true&includeHidden=true', {
        cache: 'no-store',
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const message = payload && typeof payload === 'object' && 'error' in payload
          ? String(payload.error)
          : 'Failed to load qualification records';
        throw new Error(message);
      }
      if (!Array.isArray(payload)) {
        throw new Error('Qualification records returned an invalid response');
      }

      const nextRecords = payload as QualificationRecord[];
      setRecords(nextRecords);
      setSelectedRecordIds((current) => {
        const availableIds = new Set(nextRecords.map((record) => record.id));
        return new Set(Array.from(current).filter((id) => availableIds.has(id)));
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load qualification records';
      setFetchError(message);
      showError(message);
    } finally {
      setIsLoading(false);
    }
  }, [showError]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const trainingOptions = useMemo(() => {
    const byId = new Map<number, QualificationRecord['training']>();
    for (const record of records) {
      byId.set(record.training.id, record.training);
    }
    return Array.from(byId.values()).sort((left, right) => left.name.localeCompare(right.name));
  }, [records]);

  const practicalTrainingOptions = useMemo(
    () => trainingOptions.filter((training) => training.requiresOrbatQualification),
    [trainingOptions],
  );

  const filteredRecords = useMemo(() => {
    const normalizedUserFilter = userFilter.trim().toLowerCase();
    return records.filter((record) => {
      const matchesUser = !normalizedUserFilter
        || (record.user.username ?? '').toLowerCase().includes(normalizedUserFilter)
        || String(record.user.id).includes(normalizedUserFilter);
      const matchesTraining = trainingFilter === 'all' || record.trainingId === Number(trainingFilter);
      const matchesStatus = statusFilter === 'all' || record.status === statusFilter;
      return matchesUser && matchesTraining && matchesStatus;
    });
  }, [records, statusFilter, trainingFilter, userFilter]);

  const selectedRecords = useMemo(
    () => records.filter((record) => selectedRecordIds.has(record.id)),
    [records, selectedRecordIds],
  );

  const selectedBulkTrainingId = Number(bulkTrainingId);

  const updateRecord = async (record: QualificationRecord, status: QualificationActionStatus) => {
    if (status === 'failed' && !window.confirm(`Mark ${record.user.username || `User ${record.userId}`} as failed for ${record.training.name}?`)) {
      return;
    }

    setSavingRecordId(record.id);
    setRecordErrors((current) => ({ ...current, [record.id]: '' }));
    try {
      const noteOverride = notesByRecordId[record.id];
      const response = await fetch(`/api/user-trainings/${record.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status,
          ...(noteOverride === undefined ? {} : { notes: noteOverride }),
        }),
      });
      const payload = await readResponsePayload(response);
      if (!response.ok) {
        throw new Error(typeof payload.error === 'string' ? payload.error : 'Failed to update qualification');
      }

      const updated = payload as unknown as QualificationRecord;
      setRecords((current) => current.map((item) => item.id === record.id ? updated : item));
      setNotesByRecordId((current) => {
        const next = { ...current };
        delete next[record.id];
        return next;
      });
      setSelectedRecordIds((current) => {
        const next = new Set(current);
        next.delete(record.id);
        return next;
      });
      showSuccess(`${record.training.name} updated to ${formatStatus(status)}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update qualification';
      setRecordErrors((current) => ({ ...current, [record.id]: message }));
      showError(message);
    } finally {
      setSavingRecordId(null);
    }
  };

  const selectVisibleEligible = () => {
    if (!Number.isInteger(selectedBulkTrainingId) || selectedBulkTrainingId <= 0) {
      showError('Choose a training for the bulk action first');
      return;
    }
    const eligibleIds = filteredRecords
      .filter((record) =>
        record.trainingId === selectedBulkTrainingId
        && getIndividualActions(record).some((action) => action.status === 'needs_qualify'),
      )
      .map((record) => record.id);
    setSelectedRecordIds(new Set(eligibleIds));
    if (eligibleIds.length === 0) {
      showError('No visible records can move to needs qualification');
    }
  };

  const applyBulkStatus = async () => {
    if (!Number.isInteger(selectedBulkTrainingId) || selectedBulkTrainingId <= 0 || selectedRecords.length === 0) {
      setBulkError('Choose a training and at least one eligible user');
      return;
    }

    const selectedForTraining = selectedRecords.filter((record) => record.trainingId === selectedBulkTrainingId);
    if (selectedForTraining.length !== selectedRecords.length) {
      setBulkError('All selected records must belong to the bulk training');
      return;
    }

    setIsBulkSaving(true);
    setBulkError(null);
    try {
      const response = await fetch('/api/user-trainings/bulk-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          trainingId: selectedBulkTrainingId,
          userIds: selectedForTraining.map((record) => record.userId),
          status: 'needs_qualify',
          notes: bulkNotes,
        }),
      });
      const payload = await readResponsePayload(response);
      if (!response.ok) {
        throw new Error(typeof payload.error === 'string' ? payload.error : 'Bulk qualification update failed');
      }

      const updatedCount = typeof payload.updated === 'number' ? payload.updated : selectedForTraining.length;
      showSuccess(`${updatedCount} ${updatedCount === 1 ? 'user' : 'users'} set to Needs Qualification`);
      setSelectedRecordIds(new Set());
      setBulkNotes('');
      await refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Bulk qualification update failed';
      setBulkError(message);
      showError(message);
    } finally {
      setIsBulkSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div>
          <h2 className="text-xl font-semibold" style={{ color: 'var(--foreground)' }}>
            Qualification Management
          </h2>
          <p className="mt-1 text-sm" style={{ color: 'var(--muted-foreground)' }}>
            Review trainee credentials, record outcomes, and stage practical ORBAT qualification attempts.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={isLoading || isBulkSaving || savingRecordId !== null}
          className="inline-flex items-center justify-center gap-2 rounded border px-3 py-2 text-sm font-medium disabled:opacity-50"
          style={{ borderColor: 'var(--border)', color: 'var(--foreground)', backgroundColor: 'var(--background)' }}
        >
          {isLoading && <LoadingSpinner size="sm" />}
          Refresh
        </button>
      </div>

      <div className="grid gap-3 rounded-lg border p-4 md:grid-cols-3" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--background)' }}>
        <label className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>
          User
          <input
            type="search"
            value={userFilter}
            onChange={(event) => setUserFilter(event.target.value)}
            placeholder="Name or user ID"
            className="mt-1 w-full rounded border px-3 py-2 font-normal"
            style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
          />
        </label>
        <label className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>
          Training
          <select
            value={trainingFilter}
            onChange={(event) => setTrainingFilter(event.target.value)}
            className="mt-1 w-full rounded border px-3 py-2 font-normal"
            style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
          >
            <option value="all">All trainings</option>
            {trainingOptions.map((training) => (
              <option key={training.id} value={training.id}>{training.name}</option>
            ))}
          </select>
        </label>
        <label className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>
          Status
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            className="mt-1 w-full rounded border px-3 py-2 font-normal"
            style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
          >
            <option value="all">All statuses</option>
            {USER_TRAINING_STATUSES.map((status) => (
              <option key={status} value={status}>{formatStatus(status)}</option>
            ))}
          </select>
        </label>
      </div>

      <section className="space-y-3 rounded-lg border p-4" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--background)' }}>
        <div>
          <h3 className="font-semibold" style={{ color: 'var(--foreground)' }}>Bulk Needs Qualification</h3>
          <p className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
            Choose one practical training, select eligible visible users, then grant temporary ORBAT access.
          </p>
        </div>
        <div className="grid gap-3 lg:grid-cols-[minmax(12rem,1fr)_minmax(16rem,2fr)_auto] lg:items-end">
          <label className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>
            Training for bulk action
            <select
              value={bulkTrainingId}
              onChange={(event) => {
                setBulkTrainingId(event.target.value);
                setSelectedRecordIds(new Set());
                setBulkError(null);
              }}
              className="mt-1 w-full rounded border px-3 py-2 font-normal"
              style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
            >
              <option value="">Choose training</option>
              {practicalTrainingOptions.map((training) => (
                <option key={training.id} value={training.id}>{training.name}</option>
              ))}
            </select>
          </label>
          <label className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>
            Notes for selected users
            <input
              type="text"
              value={bulkNotes}
              onChange={(event) => setBulkNotes(event.target.value)}
              maxLength={4000}
              placeholder="Optional qualification instructions or feedback"
              className="mt-1 w-full rounded border px-3 py-2 font-normal"
              style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={selectVisibleEligible}
              disabled={!bulkTrainingId || isBulkSaving}
              className="rounded border px-3 py-2 text-sm font-medium disabled:opacity-50"
              style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }}
            >
              Select eligible visible
            </button>
            <button
              type="button"
              onClick={() => setSelectedRecordIds(new Set())}
              disabled={selectedRecordIds.size === 0 || isBulkSaving}
              className="rounded border px-3 py-2 text-sm font-medium disabled:opacity-50"
              style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }}
            >
              Clear
            </button>
          </div>
        </div>
        <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
          <span className="text-sm" style={{ color: 'var(--muted-foreground)' }}>
            {selectedRecordIds.size} selected
          </span>
          <button
            type="button"
            onClick={() => void applyBulkStatus()}
            disabled={isBulkSaving || selectedRecordIds.size === 0 || !bulkTrainingId}
            className="inline-flex items-center justify-center gap-2 rounded px-4 py-2 text-sm font-medium disabled:opacity-50"
            style={{ backgroundColor: 'var(--primary)', color: 'var(--primary-foreground)' }}
          >
            {isBulkSaving && <LoadingSpinner size="sm" />}
            Set selected to Needs Qualification
          </button>
        </div>
        {bulkError && <p className="text-sm" style={{ color: 'var(--destructive)' }}>{bulkError}</p>}
      </section>

      <div className="flex items-center justify-between gap-3 text-sm" style={{ color: 'var(--muted-foreground)' }}>
        <span>{filteredRecords.length} of {records.length} records</span>
        <span>The server validates every transition before applying it.</span>
      </div>

      {isLoading && records.length === 0 ? (
        <div className="flex justify-center py-12" style={{ color: 'var(--foreground)' }}><LoadingSpinner /></div>
      ) : fetchError && records.length === 0 ? (
        <div className="rounded-lg border p-6 text-center" style={{ borderColor: 'var(--destructive)', color: 'var(--destructive)' }}>
          {fetchError}
        </div>
      ) : filteredRecords.length === 0 ? (
        <div className="rounded-lg border p-8 text-center text-sm" style={{ borderColor: 'var(--border)', color: 'var(--muted-foreground)' }}>
          No qualification records match the current filters.
        </div>
      ) : (
        <div className="space-y-3">
          {filteredRecords.map((record) => {
            const actions = getIndividualActions(record);
            const canSelectForBulk = selectedBulkTrainingId === record.trainingId
              && actions.some((action) => action.status === 'needs_qualify');
            return (
              <article
                key={record.id}
                className="rounded-lg border p-4"
                style={{ borderColor: selectedRecordIds.has(record.id) ? 'var(--primary)' : 'var(--border)', backgroundColor: 'var(--background)' }}
              >
                <div className="grid gap-4 xl:grid-cols-[auto_minmax(10rem,1fr)_minmax(12rem,1.3fr)_minmax(16rem,2fr)] xl:items-start">
                  <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--muted-foreground)' }}>
                    <input
                      type="checkbox"
                      checked={selectedRecordIds.has(record.id)}
                      disabled={!canSelectForBulk || isBulkSaving}
                      onChange={(event) => {
                        setSelectedRecordIds((current) => {
                          const next = new Set(current);
                          if (event.target.checked) next.add(record.id);
                          else next.delete(record.id);
                          return next;
                        });
                      }}
                      aria-label={`Select ${record.user.username || `User ${record.userId}`} for bulk qualification`}
                    />
                    Bulk
                  </label>

                  <div>
                    <div className="flex items-center gap-2">
                      {record.user.avatarUrl && (
                        <img src={record.user.avatarUrl} alt="" width={32} height={32} className="rounded-full" />
                      )}
                      <div>
                        <p className="font-semibold" style={{ color: 'var(--foreground)' }}>
                          {record.user.username || `User ${record.userId}`}
                        </p>
                        <p className="text-xs" style={{ color: 'var(--muted-foreground)' }}>User #{record.userId}</p>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <p className="font-medium" style={{ color: 'var(--foreground)' }}>{record.training.name}</p>
                    <TrainingStatusBadge status={record.status} />
                    <p className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
                      Updated {new Date(record.statusUpdatedAt).toLocaleString()}
                    </p>
                    <p className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
                      Trainer: {record.trainer?.username || 'Unassigned'}
                      {record.isHidden ? ' · Hidden from user' : ''}
                    </p>
                  </div>

                  <div className="space-y-2">
                    <label className="block text-xs font-medium" style={{ color: 'var(--foreground)' }}>
                      Notes
                      <textarea
                        rows={2}
                        maxLength={4000}
                        value={notesByRecordId[record.id] ?? record.notes ?? ''}
                        onChange={(event) => setNotesByRecordId((current) => ({ ...current, [record.id]: event.target.value }))}
                        placeholder="Optional notes saved with the next status change"
                        className="mt-1 w-full rounded border px-3 py-2 text-sm font-normal"
                        style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
                      />
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {actions.map((action) => (
                        <button
                          key={action.status}
                          type="button"
                          disabled={savingRecordId !== null || isBulkSaving}
                          onClick={() => void updateRecord(record, action.status)}
                          className="inline-flex items-center gap-2 rounded border px-3 py-1.5 text-sm font-medium disabled:opacity-50"
                          style={{
                            borderColor: action.destructive ? 'var(--destructive)' : 'var(--border)',
                            color: action.destructive ? 'var(--destructive)' : 'var(--foreground)',
                          }}
                        >
                          {savingRecordId === record.id && <LoadingSpinner size="sm" />}
                          {action.label}
                        </button>
                      ))}
                      {actions.length === 0 && (
                        <span className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
                          No qualification action is available from this status.
                        </span>
                      )}
                    </div>
                    {record.training.requiresOrbatQualification && record.training.orbatQualificationNotes && (
                      <p className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
                        Qualification guidance: {record.training.orbatQualificationNotes}
                      </p>
                    )}
                    {recordErrors[record.id] && (
                      <p className="text-sm" style={{ color: 'var(--destructive)' }}>{recordErrors[record.id]}</p>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
