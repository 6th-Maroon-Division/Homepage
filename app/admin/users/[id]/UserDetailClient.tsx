'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useToast } from '@/app/components/ui/ToastContainer';

type UserPermission = {
  id: number;
  key: string;
  description: string;
  currentValue: number;
  maxValue: number;
};

type UserTraining = {
  id: number;
  trainingId: number;
  trainingName: string;
  completedAt: string;
  needsRetraining: boolean;
  isHidden: boolean;
  notes: string | null;
  trainerId: number | null;
  trainerUsername: string | null;
};

type LoaEntry = {
  id: number;
  startDate: string;
  returnDate: string | null;
  cancelledAt: string | null;
  reason: string | null;
  createdAt: string;
  updatedAt: string;
};

type AvailableTraining = {
  id: number;
  name: string;
  categoryId: number | null;
  duration: number | null;
};

type AttendanceEntry = {
  id: number;
  createdAt: string;
  status: string;
  orbatName: string;
  orbatDate: string;
};

type MonthlyTrend = {
  month: string;
  count: number;
};

type UserDetailData = {
  id: number;
  username: string | null;
  email: string | null;
  avatarUrl: string | null;
  createdAt: string;
  providers: string[];
  signupCount: number;
  orbatCount: number;
  trainingCount: number;
  currentRank: string | null;
  attendanceSinceLastRank: number;
  trainings: UserTraining[];
  loaEntries: LoaEntry[];
};

type AttendanceMetrics = {
  totalCount: number;
  lastAttendanceDate: string | null;
  count30d: number;
  count90d: number;
  trend: MonthlyTrend[];
  recent: AttendanceEntry[];
};

type UserDetailClientProps = {
  user: UserDetailData;
  attendance: AttendanceMetrics;
  permissions: UserPermission[];
  availableTrainings: AvailableTraining[];
  canViewTrainings: boolean;
  canAssignTrainings: boolean;
  canViewPermissions: boolean;
  canEditPermissions: boolean;
  canViewActions: boolean;
  canManagePromotions: boolean;
  promoteRank: { id: number; name: string; abbreviation: string } | null;
  demoteRank: { id: number; name: string; abbreviation: string } | null;
  isSelfUser: boolean;
};

type TabKey = 'overview' | 'attendance' | 'loa' | 'trainings' | 'permissions' | 'actions';

export default function UserDetailClient({
  user,
  attendance,
  permissions,
  availableTrainings,
  canViewTrainings,
  canAssignTrainings,
  canViewPermissions,
  canEditPermissions,
  canViewActions,
  canManagePromotions,
  promoteRank,
  demoteRank,
  isSelfUser,
}: UserDetailClientProps) {
  const { showError, showSuccess } = useToast();
  const router = useRouter();
  const [permissionRows, setPermissionRows] = useState<UserPermission[]>(permissions);
  const [trainingRows, setTrainingRows] = useState<UserTraining[]>(user.trainings);
  const [availableTrainingRows, setAvailableTrainingRows] = useState<AvailableTraining[]>(availableTrainings);
  const [isSavingPermissions, setIsSavingPermissions] = useState(false);
  const [expandedPermissionGroups, setExpandedPermissionGroups] = useState<Record<string, boolean>>(() => {
    const groups = Array.from(
      new Set(
        permissions.map((permission) => {
          const [category] = permission.key.split(':');
          return category || 'other';
        })
      )
    );

    return Object.fromEntries(groups.map((group) => [group, false]));
  });
  const [isAssigningTraining, setIsAssigningTraining] = useState(false);
  const [isUpdatingTrainingById, setIsUpdatingTrainingById] = useState<Record<number, boolean>>({});
  const [isRemovingTrainingById, setIsRemovingTrainingById] = useState<Record<number, boolean>>({});
  const [selectedTrainingId, setSelectedTrainingId] = useState<number>(availableTrainings[0]?.id ?? 0);
  const [trainingNotes, setTrainingNotes] = useState('');

  const groupedPermissions = useMemo(() => {
    const groupMap = new Map<string, UserPermission[]>();

    for (const permission of permissionRows) {
      const [category] = permission.key.split(':');
      const groupKey = category || 'other';
      const existing = groupMap.get(groupKey) ?? [];
      existing.push(permission);
      groupMap.set(groupKey, existing);
    }

    return Array.from(groupMap.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [permissionRows]);

  useEffect(() => {
    setExpandedPermissionGroups((previous) => {
      const next = { ...previous };
      for (const [group] of groupedPermissions) {
        if (!(group in next)) {
          next[group] = false;
        }
      }
      return next;
    });
  }, [groupedPermissions]);

  useEffect(() => {
    setTrainingRows(user.trainings);
  }, [user.trainings]);

  useEffect(() => {
    setAvailableTrainingRows(availableTrainings);
  }, [availableTrainings]);

  const visibleTabs: Array<{ key: TabKey; label: string }> = [
    { key: 'overview', label: 'Overview' },
    { key: 'attendance', label: 'Attendance' },
    { key: 'loa', label: 'LOA' },
    ...(canViewTrainings ? [{ key: 'trainings' as const, label: 'Trainings' }] : []),
    ...(canViewPermissions ? [{ key: 'permissions' as const, label: 'Permissions' }] : []),
    ...(canViewActions ? [{ key: 'actions' as const, label: 'Actions' }] : []),
  ];

  const [activeTab, setActiveTab] = useState<TabKey>(visibleTabs[0]?.key ?? 'overview');
  const [isDeleting, setIsDeleting] = useState(false);
  const [isPromoting, setIsPromoting] = useState(false);
  const [isDemoting, setIsDemoting] = useState(false);
  const [isClearingAvatar, setIsClearingAvatar] = useState(false);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleDelete = async () => {
    if (!canViewActions || isDeleting) return;
    const confirmed = window.confirm(`Delete ${user.username || 'this user'}? This cannot be undone.`);
    if (!confirmed) return;

    setIsDeleting(true);
    try {
      const res = await fetch(`/api/users/${user.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to delete user');
      }
      showSuccess('User deleted successfully');
      router.push('/admin/users');
      router.refresh();
    } catch (error) {
      showError(error instanceof Error ? error.message : 'Failed to delete user');
      setIsDeleting(false);
    }
  };

  const handleClearAvatar = async () => {
    if (!canViewActions || isClearingAvatar) return;
    const confirmed = window.confirm(`Clear ${user.username || 'this user'}'s avatar?`);
    if (!confirmed) return;

    setIsClearingAvatar(true);
    try {
      const res = await fetch(`/api/users/${user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ avatarUrl: null }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to clear avatar');
      }
      showSuccess('Avatar cleared successfully');
      router.refresh();
    } catch (error) {
      showError(error instanceof Error ? error.message : 'Failed to clear avatar');
      setIsClearingAvatar(false);
    }
  };

  useEffect(() => {
    const source = new EventSource(`/api/users/${user.id}/events`);

    source.onmessage = () => {
      if (refreshTimerRef.current) {
        return;
      }

      refreshTimerRef.current = setTimeout(() => {
        refreshTimerRef.current = null;
        router.refresh();
      }, 250);
    };

    return () => {
      source.close();
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
  }, [router, user.id]);

  return (
    <div className="space-y-6">
      <div
        className="rounded-lg border p-4 sm:p-6"
        style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)' }}
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            {user.avatarUrl && (
              user.avatarUrl.startsWith('data:') ? (
                <img
                  src={user.avatarUrl}
                  alt={user.username || 'User'}
                  width={48}
                  height={48}
                  className="rounded-full"
                />
              ) : (
                <Image
                  src={user.avatarUrl}
                  alt={user.username || 'User'}
                  width={48}
                  height={48}
                  className="rounded-full"
                />
              )
            )}
            <div>
              <h1 className="text-2xl font-bold" style={{ color: 'var(--foreground)' }}>
                {user.username || 'Unknown User'}
              </h1>
            <p className="text-sm mt-1" style={{ color: 'var(--muted-foreground)' }}>
              ID: {user.id} • Joined {new Date(user.createdAt).toLocaleDateString('en-GB')}
            </p>
            <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>
              {user.email || 'No email'}
            </p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded border px-3 py-2" style={{ borderColor: 'var(--border)' }}>
              <div style={{ color: 'var(--muted-foreground)' }}>Total Attendance</div>
              <div className="font-semibold" style={{ color: 'var(--foreground)' }}>{attendance.totalCount}</div>
            </div>
            <div className="rounded border px-3 py-2" style={{ borderColor: 'var(--border)' }}>
              <div style={{ color: 'var(--muted-foreground)' }}>Last Attendance</div>
              <div className="font-semibold" style={{ color: 'var(--foreground)' }}>
                {attendance.lastAttendanceDate
                  ? new Date(attendance.lastAttendanceDate).toLocaleDateString('en-GB')
                  : 'Never'}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="border-b" style={{ borderColor: 'var(--border)' }}>
        <div className="flex flex-wrap gap-2">
          {visibleTabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className="px-4 py-2 text-sm rounded-t-md border"
              style={{
                borderColor: 'var(--border)',
                backgroundColor: activeTab === tab.key ? 'var(--secondary)' : 'var(--muted)',
                color: activeTab === tab.key ? 'var(--foreground)' : 'var(--muted-foreground)',
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <InfoCard label="Providers" value={user.providers.length ? user.providers.join(', ') : 'None'} />
          <InfoCard label="Current Rank" value={user.currentRank || 'Unranked'} />
          <InfoCard label="Signups" value={String(user.signupCount)} />
          <InfoCard label="OrbATs" value={String(user.orbatCount)} />
          <InfoCard label="Trainings" value={String(user.trainingCount)} />
          <InfoCard label="Attendance Since Last Rank" value={String(user.attendanceSinceLastRank)} />
        </div>
      )}

      {activeTab === 'attendance' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <InfoCard label="30-day Attendance" value={String(attendance.count30d)} />
            <InfoCard label="90-day Attendance" value={String(attendance.count90d)} />
            <InfoCard label="Since Last Rank" value={String(user.attendanceSinceLastRank)} />
          </div>

          <div className="rounded-lg border p-4" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--secondary)' }}>
            <h3 className="font-semibold mb-3" style={{ color: 'var(--foreground)' }}>6-Month Trend</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
              {attendance.trend.map((point) => (
                <div key={point.month} className="rounded border p-2 text-center" style={{ borderColor: 'var(--border)' }}>
                  <div className="text-xs" style={{ color: 'var(--muted-foreground)' }}>{point.month}</div>
                  <div className="font-semibold" style={{ color: 'var(--foreground)' }}>{point.count}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-lg border p-4" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--secondary)' }}>
            <h3 className="font-semibold mb-3" style={{ color: 'var(--foreground)' }}>Recent Attendance</h3>
            <div className="space-y-2">
              {attendance.recent.length === 0 ? (
                <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>No attendance records.</p>
              ) : (
                attendance.recent.map((entry) => (
                  <div key={entry.id} className="rounded border p-3 text-sm" style={{ borderColor: 'var(--border)' }}>
                    <div className="font-medium" style={{ color: 'var(--foreground)' }}>{entry.orbatName}</div>
                    <div style={{ color: 'var(--muted-foreground)' }}>
                      {new Date(entry.orbatDate).toLocaleDateString('en-GB')} • {entry.status}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'loa' && (
        <div className="rounded-lg border p-4" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--secondary)' }}>
          <h3 className="font-semibold mb-3" style={{ color: 'var(--foreground)' }}>Leave Of Absence</h3>
          <div className="space-y-2">
            {user.loaEntries.length === 0 ? (
              <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>No LOA entries.</p>
            ) : (
              user.loaEntries.map((entry) => {
                const startDate = new Date(entry.startDate);
                const endDate = entry.returnDate ? new Date(entry.returnDate) : new Date();
                const isCancelled = !!entry.cancelledAt;
                const isActive = !isCancelled && new Date(entry.startDate) <= new Date()
                  && (!entry.returnDate || new Date(entry.returnDate) >= new Date());
                const durationDays = Math.max(
                  1,
                  Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24))
                );

                return (
                  <div key={entry.id} className="rounded border p-3" style={{ borderColor: 'var(--border)' }}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-sm" style={{ color: 'var(--foreground)' }}>
                        <span className="font-medium">Start:</span> {new Date(entry.startDate).toLocaleDateString('en-GB')}
                        {' • '}
                        <span className="font-medium">Return:</span>{' '}
                        {entry.returnDate ? new Date(entry.returnDate).toLocaleDateString('en-GB') : 'Not set'}
                      </div>
                      <span
                        className="px-2 py-1 rounded text-xs font-medium"
                        style={{
                          backgroundColor: isCancelled ? 'var(--destructive)' : isActive ? 'var(--accent)' : 'var(--muted)',
                          color: isCancelled ? 'var(--destructive-foreground)' : isActive ? 'var(--accent-foreground)' : 'var(--foreground)',
                        }}
                      >
                        {isCancelled ? 'Cancelled' : isActive ? 'Active' : 'Returned'}
                      </span>
                    </div>
                    {entry.reason && (
                      <p className="text-sm mt-2" style={{ color: 'var(--muted-foreground)' }}>
                        Reason: {entry.reason}
                      </p>
                    )}
                    <p className="text-sm mt-1" style={{ color: 'var(--muted-foreground)' }}>
                      Duration: {durationDays} day(s)
                    </p>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {activeTab === 'trainings' && canViewTrainings && (
        <div className="space-y-4">
          {canAssignTrainings && (
            <div className="rounded-lg border p-4" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--secondary)' }}>
              <h3 className="font-semibold mb-3" style={{ color: 'var(--foreground)' }}>Assign Training</h3>

              {availableTrainingRows.length === 0 ? (
                <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>No available trainings left for this user.</p>
              ) : (
                <div className="space-y-3">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <select
                      value={selectedTrainingId}
                      onChange={(event) => setSelectedTrainingId(Number(event.target.value))}
                      className="px-3 py-2 rounded border text-sm md:col-span-2"
                      style={{
                        borderColor: 'var(--border)',
                        backgroundColor: 'var(--background)',
                        color: 'var(--foreground)',
                      }}
                    >
                      <option value={0} disabled>
                        Select a training...
                      </option>
                      {availableTrainingRows.map((training) => (
                        <option key={training.id} value={training.id}>
                          {training.name}
                        </option>
                      ))}
                    </select>
                    <button
                      disabled={isAssigningTraining || !selectedTrainingId}
                      onClick={async () => {
                        if (!selectedTrainingId) return;
                        setIsAssigningTraining(true);
                        try {
                          const response = await fetch('/api/user-trainings', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              userId: user.id,
                              trainingId: selectedTrainingId,
                              notes: trainingNotes.trim() || null,
                            }),
                          });

                          if (!response.ok) {
                            const data = await response.json().catch(() => ({}));
                            throw new Error(data.error || 'Failed to assign training');
                          }

                          const created = await response.json();
                          const createdRow: UserTraining = {
                            id: created.id,
                            trainingId: created.trainingId,
                            trainingName: created.training.name,
                            completedAt: created.completedAt,
                            needsRetraining: created.needsRetraining,
                            isHidden: created.isHidden,
                            notes: created.notes,
                            trainerId: created.trainerId ?? null,
                            trainerUsername: created.trainer?.username ?? null,
                          };

                          setTrainingRows((prev) => [createdRow, ...prev]);
                          
                          // Compute new available trainings by removing the assigned one
                          const newAvailableTrainings = availableTrainingRows.filter((training) => training.id !== selectedTrainingId);
                          setAvailableTrainingRows(newAvailableTrainings);
                          setTrainingNotes('');
                          
                          // Reset selected training to the first available, or 0 if none left
                          setSelectedTrainingId(newAvailableTrainings.length > 0 ? newAvailableTrainings[0].id : 0);
                          showSuccess('Training assigned');
                          router.refresh();
                        } catch (error) {
                          showError(error instanceof Error ? error.message : 'Failed to assign training');
                        } finally {
                          setIsAssigningTraining(false);
                        }
                      }}
                      className="px-3 py-2 rounded text-sm font-medium disabled:opacity-50"
                      style={{ backgroundColor: 'var(--primary)', color: 'var(--primary-foreground)' }}
                    >
                      {isAssigningTraining ? 'Assigning…' : 'Assign'}
                    </button>
                  </div>

                  <textarea
                    value={trainingNotes}
                    onChange={(event) => setTrainingNotes(event.target.value)}
                    placeholder="Optional assignment notes"
                    rows={2}
                    className="w-full px-3 py-2 rounded border text-sm"
                    style={{
                      borderColor: 'var(--border)',
                      backgroundColor: 'var(--background)',
                      color: 'var(--foreground)',
                    }}
                  />

                  <div>
                    <p className="text-xs mb-2" style={{ color: 'var(--muted-foreground)' }}>
                      Short list of available trainings
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                      {availableTrainingRows.slice(0, 6).map((training) => (
                        <div
                          key={training.id}
                          className="rounded border px-3 py-2 text-sm"
                          style={{ borderColor: 'var(--border)' }}
                        >
                          <div className="font-medium" style={{ color: 'var(--foreground)' }}>
                            {training.name}
                          </div>
                          <div className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
                            {training.duration ? `${training.duration} min` : 'Duration n/a'}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="rounded-lg border p-4" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--secondary)' }}>
            <h3 className="font-semibold mb-3" style={{ color: 'var(--foreground)' }}>Training History</h3>
            <div className="space-y-2">
              {trainingRows.length === 0 ? (
                <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>No trainings assigned.</p>
              ) : (
                trainingRows.map((training) => (
                  <div key={training.id} className="rounded border p-3" style={{ borderColor: 'var(--border)' }}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="font-medium" style={{ color: 'var(--foreground)' }}>{training.trainingName}</div>
                        <div className="text-sm" style={{ color: 'var(--muted-foreground)' }}>
                          Completed: {new Date(training.completedAt).toLocaleDateString('en-GB')}
                        </div>
                        <div className="text-sm" style={{ color: 'var(--muted-foreground)' }}>
                          Trainer: {training.trainerUsername || 'Unknown'}
                        </div>
                        {training.needsRetraining && (
                          <span
                            className="inline-block mt-2 px-2 py-1 rounded text-xs"
                            style={{ backgroundColor: 'var(--accent)', color: 'var(--accent-foreground)' }}
                          >
                            Needs Retraining
                          </span>
                        )}
                      </div>

                      {canAssignTrainings && (
                        <div className="flex flex-wrap gap-2">
                          <button
                            disabled={isUpdatingTrainingById[training.id] || isRemovingTrainingById[training.id]}
                            onClick={async () => {
                              setIsUpdatingTrainingById((previous) => ({ ...previous, [training.id]: true }));
                              try {
                                const response = await fetch(`/api/user-trainings/${training.id}`, {
                                  method: 'PUT',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({
                                    notes: training.notes,
                                    isHidden: training.isHidden,
                                    needsRetraining: !training.needsRetraining,
                                  }),
                                });

                                if (!response.ok) {
                                  const data = await response.json().catch(() => ({}));
                                  throw new Error(data.error || 'Failed to update training');
                                }

                                setTrainingRows((previous) =>
                                  previous.map((row) =>
                                    row.id === training.id
                                      ? { ...row, needsRetraining: !training.needsRetraining }
                                      : row
                                  )
                                );

                                showSuccess(
                                  !training.needsRetraining
                                    ? 'Training marked as needing retraining'
                                    : 'Retraining requirement cleared'
                                );
                                router.refresh();
                              } catch (error) {
                                showError(error instanceof Error ? error.message : 'Failed to update training');
                              } finally {
                                setIsUpdatingTrainingById((previous) => ({ ...previous, [training.id]: false }));
                              }
                            }}
                            className="px-3 py-1 rounded text-xs font-medium disabled:opacity-50"
                            style={{ backgroundColor: 'var(--primary)', color: 'var(--primary-foreground)' }}
                          >
                            {isUpdatingTrainingById[training.id]
                              ? 'Saving...'
                              : training.needsRetraining
                                ? 'Clear Retraining'
                                : 'Needs Retraining'}
                          </button>

                          <button
                            disabled={isUpdatingTrainingById[training.id] || isRemovingTrainingById[training.id]}
                            onClick={async () => {
                              const confirmed = window.confirm(`Remove ${training.trainingName} from this user?`);
                              if (!confirmed) {
                                return;
                              }

                              setIsRemovingTrainingById((previous) => ({ ...previous, [training.id]: true }));
                              try {
                                const response = await fetch(`/api/user-trainings/${training.id}`, {
                                  method: 'DELETE',
                                });

                                if (!response.ok) {
                                  const data = await response.json().catch(() => ({}));
                                  throw new Error(data.error || 'Failed to remove training');
                                }

                                setTrainingRows((previous) => previous.filter((row) => row.id !== training.id));
                                setAvailableTrainingRows((previous) => {
                                  if (previous.some((row) => row.id === training.trainingId)) {
                                    return previous;
                                  }

                                  return [
                                    ...previous,
                                    {
                                      id: training.trainingId,
                                      name: training.trainingName,
                                      categoryId: null,
                                      duration: null,
                                    },
                                  ];
                                });
                                showSuccess('Training removed');
                                router.refresh();
                              } catch (error) {
                                showError(error instanceof Error ? error.message : 'Failed to remove training');
                              } finally {
                                setIsRemovingTrainingById((previous) => ({ ...previous, [training.id]: false }));
                              }
                            }}
                            className="px-3 py-1 rounded text-xs font-medium disabled:opacity-50"
                            style={{ backgroundColor: 'var(--destructive)', color: 'var(--destructive-foreground)' }}
                          >
                            {isRemovingTrainingById[training.id] ? 'Removing...' : 'Remove'}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'permissions' && canViewPermissions && (
        <div className="rounded-lg border p-4" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--secondary)' }}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold" style={{ color: 'var(--foreground)' }}>Permissions</h3>
            <button
              disabled={isSavingPermissions || !canEditPermissions || isSelfUser}
              onClick={async () => {
                if (!canEditPermissions || isSelfUser) return;
                setIsSavingPermissions(true);
                try {
                  const payload = permissionRows.map((permission) => ({
                    permissionId: permission.id,
                    value: permission.currentValue,
                  }));
                  const res = await fetch(`/api/users/${user.id}/permissions`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ permissions: payload }),
                  });

                  if (!res.ok) {
                    const data = await res.json().catch(() => ({}));
                    throw new Error(data.error || 'Failed to save permissions');
                  }

                  showSuccess('Permissions updated');
                  router.refresh();
                } catch (error) {
                  showError(error instanceof Error ? error.message : 'Failed to save permissions');
                } finally {
                  setIsSavingPermissions(false);
                }
              }}
              className="px-3 py-1 rounded text-sm font-medium disabled:opacity-50"
              style={{ backgroundColor: 'var(--primary)', color: 'var(--primary-foreground)' }}
            >
              {isSavingPermissions ? 'Saving…' : 'Save'}
            </button>
          </div>

          {!canEditPermissions && (
            <p className="text-xs mb-3" style={{ color: 'var(--muted-foreground)' }}>
              Read-only: you do not have permission to modify user permissions.
            </p>
          )}

          {isSelfUser && (
            <p className="text-xs mb-3" style={{ color: 'var(--muted-foreground)' }}>
              Read-only: self-permission changes are blocked.
            </p>
          )}

          <div className="space-y-2">
            {permissionRows.length === 0 ? (
              <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>No permissions available.</p>
            ) : (
              groupedPermissions.map(([group, groupPermissions]) => {
                const isExpanded = expandedPermissionGroups[group] ?? false;

                return (
                  <div key={group} className="rounded border" style={{ borderColor: 'var(--border)' }}>
                    <button
                      type="button"
                      onClick={() => {
                        setExpandedPermissionGroups((previous) => ({
                          ...previous,
                          [group]: !isExpanded,
                        }));
                      }}
                      className="w-full px-3 py-2 flex items-center justify-between text-left"
                      style={{ backgroundColor: 'var(--muted)' }}
                    >
                      <span className="font-medium" style={{ color: 'var(--foreground)' }}>
                        {group}
                      </span>
                      <span className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
                        {groupPermissions.length} • {isExpanded ? 'Hide' : 'Show'}
                      </span>
                    </button>

                    {isExpanded && (
                      <div className="p-2 space-y-2">
                        {groupPermissions.map((permission) => (
                          <div key={permission.key} className="rounded border p-3 flex items-center justify-between" style={{ borderColor: 'var(--border)' }}>
                            <div>
                              <div className="font-medium" style={{ color: 'var(--foreground)' }}>{permission.key}</div>
                              <div className="text-xs" style={{ color: 'var(--muted-foreground)' }}>{permission.description}</div>
                            </div>
                            <input
                              type="number"
                              min={0}
                              max={permission.maxValue}
                              value={permission.currentValue}
                              disabled={!canEditPermissions || isSelfUser}
                              onChange={(event) => {
                                const rawValue = Number(event.target.value);
                                const boundedValue = Number.isFinite(rawValue)
                                  ? Math.min(permission.maxValue, Math.max(0, Math.trunc(rawValue)))
                                  : 0;

                                setPermissionRows((prev) =>
                                  prev.map((row) =>
                                    row.id === permission.id
                                      ? { ...row, currentValue: boundedValue }
                                      : row
                                  )
                                );
                              }}
                              className="w-24 px-2 py-1 rounded border text-sm"
                              style={{
                                borderColor: 'var(--border)',
                                backgroundColor: 'var(--background)',
                                color: 'var(--foreground)',
                              }}
                            />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {activeTab === 'actions' && canViewActions && (
        <div className="rounded-lg border p-4" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--secondary)' }}>
          {canManagePromotions && (
            <div className="mb-4">
              <h3 className="font-semibold mb-3" style={{ color: 'var(--foreground)' }}>Rank Actions</h3>
              <div className="flex flex-wrap gap-2">
                <button
                  disabled={isPromoting || !promoteRank}
                  onClick={async () => {
                    if (!promoteRank) {
                      return;
                    }

                    setIsPromoting(true);
                    try {
                      const response = await fetch(`/api/users/${user.id}/rank/assign`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ rankId: promoteRank.id }),
                      });

                      if (!response.ok) {
                        const data = await response.json().catch(() => ({}));
                        throw new Error(data.error || 'Failed to promote user');
                      }

                      showSuccess(`Promoted to ${promoteRank.abbreviation} - ${promoteRank.name}`);
                      router.refresh();
                    } catch (error) {
                      showError(error instanceof Error ? error.message : 'Failed to promote user');
                    } finally {
                      setIsPromoting(false);
                    }
                  }}
                  className="px-4 py-2 rounded text-sm font-medium disabled:opacity-50"
                  style={{
                    backgroundColor: 'var(--primary)',
                    color: 'var(--primary-foreground)',
                  }}
                >
                  {isPromoting ? 'Promoting...' : promoteRank ? `Promote → ${promoteRank.abbreviation}` : 'No Higher Rank'}
                </button>

                <button
                  disabled={isDemoting || !demoteRank}
                  onClick={async () => {
                    if (!demoteRank) {
                      return;
                    }

                    const reason = window.prompt('Demotion reason (optional):') || null;

                    setIsDemoting(true);
                    try {
                      const response = await fetch(`/api/users/${user.id}/rank/demote`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ rankId: demoteRank.id, reason }),
                      });

                      if (!response.ok) {
                        const data = await response.json().catch(() => ({}));
                        throw new Error(data.error || 'Failed to demote user');
                      }

                      showSuccess(`Demoted to ${demoteRank.abbreviation} - ${demoteRank.name}`);
                      router.refresh();
                    } catch (error) {
                      showError(error instanceof Error ? error.message : 'Failed to demote user');
                    } finally {
                      setIsDemoting(false);
                    }
                  }}
                  className="px-4 py-2 rounded text-sm font-medium disabled:opacity-50"
                  style={{
                    backgroundColor: 'var(--muted)',
                    color: 'var(--foreground)',
                    border: '1px solid var(--border)',
                  }}
                >
                  {isDemoting ? 'Demoting...' : demoteRank ? `Demote → ${demoteRank.abbreviation}` : 'No Lower Rank'}
                </button>
              </div>
            </div>
          )}

          <h3 className="font-semibold mb-3" style={{ color: 'var(--foreground)' }}>Danger Zone</h3>
          <div className="space-y-2">
            <button
              onClick={handleClearAvatar}
              disabled={isClearingAvatar || isSelfUser}
              className="px-4 py-2 rounded text-sm font-medium w-full"
              style={{
                backgroundColor: 'var(--destructive)',
                color: 'var(--destructive-foreground)',
                opacity: (isClearingAvatar || isSelfUser) ? 0.7 : 1,
              }}
            >
              {isClearingAvatar ? 'Clearing...' : 'Clear Avatar'}
            </button>
            <button
              onClick={handleDelete}
              disabled={isDeleting}
              className="px-4 py-2 rounded text-sm font-medium w-full"
              style={{
                backgroundColor: 'var(--destructive)',
                color: 'var(--destructive-foreground)',
                opacity: isDeleting ? 0.7 : 1,
              }}
            >
              {isDeleting ? 'Deleting...' : 'Delete User'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-4" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--secondary)' }}>
      <div className="text-xs mb-1" style={{ color: 'var(--muted-foreground)' }}>{label}</div>
      <div className="text-lg font-semibold" style={{ color: 'var(--foreground)' }}>{value}</div>
    </div>
  );
}
