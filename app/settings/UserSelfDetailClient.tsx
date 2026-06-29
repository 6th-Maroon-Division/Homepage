'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { signIn, useSession } from 'next-auth/react';
import { useToast } from '@/app/components/ui/ToastContainer';

type UserTraining = {
  id: number;
  trainingId: number;
  trainingName: string;
  trainingDescription: string | null;
  trainingDuration: number | null;
  trainingCategoryName: string | null;
  completedAt: string;
  needsRetraining: boolean;
  isHidden: boolean;
  notes: string | null;
  trainerId: number | null;
  trainerUsername: string | null;
};

type AvailableTraining = {
  id: number;
  name: string;
  description: string | null;
  duration: number | null;
  categoryName: string | null;
  canRequest: boolean;
  missingRank: { id: number; name: string; abbreviation: string } | null;
  missingTrainings: Array<{ id: number; name: string }>;
};

type TrainingRequestItem = {
  id: number;
  trainingId: number;
  trainingName: string;
  status: string;
  requestMessage: string | null;
  adminResponse: string | null;
  requestedAt: string;
  updatedAt: string;
  handledByAdminUsername: string | null;
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
};

type AttendanceMetrics = {
  totalCount: number;
  lastAttendanceDate: string | null;
  count30d: number;
  count90d: number;
  trend: MonthlyTrend[];
  recent: AttendanceEntry[];
};

type UserSelfDetailClientProps = {
  user: UserDetailData;
  attendance: AttendanceMetrics;
  availableTrainings: AvailableTraining[];
  trainingRequests: TrainingRequestItem[];
  loaEntries: LoaEntry[];
};

type RankHistoryEntry = {
  id: number;
  previousRankName: string | null;
  newRankName: string;
  attendanceTotalAtChange: number;
  attendanceDeltaSinceLastRank: number;
  triggeredBy: string;
  outcome: string | null;
  declineReason: string | null;
  createdAt: string;
};

type RankHistoryPagination = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

type TabKey = 'overview' | 'attendance' | 'trainings' | 'loa' | 'rank-history' | 'actions';

export default function UserSelfDetailClient({ user, attendance, availableTrainings, trainingRequests, loaEntries }: UserSelfDetailClientProps) {
  const [activeTab, setActiveTab] = useState<TabKey>('overview');
  const [requestRows, setRequestRows] = useState<TrainingRequestItem[]>(trainingRequests);
  const [loaRows, setLoaRows] = useState<LoaEntry[]>(loaEntries);
  const [loaStartDate, setLoaStartDate] = useState('');
  const [loaReturnDate, setLoaReturnDate] = useState('');
  const [loaReason, setLoaReason] = useState('');
  const [loaReturnDateDrafts, setLoaReturnDateDrafts] = useState<Record<number, string>>({});
  const [isSubmittingLoa, setIsSubmittingLoa] = useState(false);
  const [isSavingLoaId, setIsSavingLoaId] = useState<number | null>(null);
  const [isMarkingBackLoaId, setIsMarkingBackLoaId] = useState<number | null>(null);
  const [isCancellingLoaId, setIsCancellingLoaId] = useState<number | null>(null);
  const [selectedTrainingId, setSelectedTrainingId] = useState<number>(0);
  const [requestMessage, setRequestMessage] = useState('');
  const [isSubmittingRequest, setIsSubmittingRequest] = useState(false);
  const [isCancellingRequestId, setIsCancellingRequestId] = useState<number | null>(null);
  const [profileImageUrl, setProfileImageUrl] = useState(user.avatarUrl ?? '');
  const [selectedAvatarFileName, setSelectedAvatarFileName] = useState<string | null>(null);
  const [isSavingAvatar, setIsSavingAvatar] = useState(false);
  const [isRefreshingSteamAvatar, setIsRefreshingSteamAvatar] = useState(false);
  const [trainingsViewTab, setTrainingsViewTab] = useState<'my-trainings' | 'available'>('my-trainings');
  const [rankHistoryRows, setRankHistoryRows] = useState<RankHistoryEntry[]>([]);
  const [rankHistoryPage, setRankHistoryPage] = useState(1);
  const [rankHistoryPagination, setRankHistoryPagination] = useState<RankHistoryPagination | null>(null);
  const [isLoadingRankHistory, setIsLoadingRankHistory] = useState(false);
  const [rankHistoryError, setRankHistoryError] = useState('');
  const avatarFileInputRef = useRef<HTMLInputElement | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const router = useRouter();
  const { update: updateSession } = useSession();
  const { showError, showSuccess } = useToast();


  const fetchRankHistory = useCallback(async (pageNum: number) => {
    setIsLoadingRankHistory(true);
    try {
      const response = await fetch(`/api/users/${user.id}/rank-history?page=${pageNum}`);
      if (!response.ok) {
        throw new Error('Failed to fetch rank history');
      }

      const data = await response.json();
      setRankHistoryRows(data.data ?? []);
      setRankHistoryPagination(data.pagination ?? null);
      setRankHistoryError('');
    } catch (error) {
      console.error('Error fetching rank history:', error);
      setRankHistoryError('Failed to load rank history');
    } finally {
      setIsLoadingRankHistory(false);
    }
  }, [user.id]);

  useEffect(() => {
    if (activeTab === 'rank-history') {
      fetchRankHistory(rankHistoryPage);
    }
  }, [activeTab, rankHistoryPage, fetchRankHistory]);

  useEffect(() => {
    const source = new EventSource('/api/user/events');

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
  }, [router]);

  return (
    <div className="space-y-6">
      <div
        className="rounded-lg border p-4 sm:p-6"
        style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)' }}
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold" style={{ color: 'var(--foreground)' }}>
              {user.username || 'Unknown User'}
            </h1>
            <p className="text-sm mt-1" style={{ color: 'var(--muted-foreground)' }}>
              Joined {new Date(user.createdAt).toLocaleDateString('en-GB')}
            </p>
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
          {[
            { key: 'overview' as const, label: 'Overview' },
            { key: 'attendance' as const, label: 'Attendance' },
            { key: 'trainings' as const, label: 'Trainings' },
            { key: 'loa' as const, label: 'LOA' },
            { key: 'rank-history' as const, label: 'Rank History' },
            { key: 'actions' as const, label: 'Actions' },
          ].map((tab) => (
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

      {activeTab === 'trainings' && (
        <div className="space-y-4">
          <div className="flex gap-2 border-b" style={{ borderColor: 'var(--border)' }}>
            <button
              onClick={() => setTrainingsViewTab('my-trainings')}
              className={`px-4 py-2 font-medium rounded-t-md border transition-colors ${
                trainingsViewTab === 'my-trainings' ? 'border-b-2' : 'hover:opacity-100'
              }`}
              style={{
                borderColor: trainingsViewTab === 'my-trainings' ? 'var(--primary)' : 'var(--border)',
                backgroundColor: trainingsViewTab === 'my-trainings' ? 'var(--secondary)' : 'var(--muted)',
                color: trainingsViewTab === 'my-trainings' ? 'var(--foreground)' : 'var(--muted-foreground)',
              }}
            >
              My Trainings ({user.trainings.length})
            </button>
            <button
              onClick={() => setTrainingsViewTab('available')}
              className={`px-4 py-2 font-medium rounded-t-md border transition-colors ${
                trainingsViewTab === 'available' ? 'border-b-2' : 'hover:opacity-100'
              }`}
              style={{
                borderColor: trainingsViewTab === 'available' ? 'var(--primary)' : 'var(--border)',
                backgroundColor: trainingsViewTab === 'available' ? 'var(--secondary)' : 'var(--muted)',
                color: trainingsViewTab === 'available' ? 'var(--foreground)' : 'var(--muted-foreground)',
              }}
            >
              Available Trainings ({availableTrainings.length})
            </button>
          </div>

          {trainingsViewTab === 'my-trainings' && (
            <div className="space-y-6">
              <div className="p-6 rounded-lg border" style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)' }}>
                <h2 className="text-xl font-semibold mb-4" style={{ color: 'var(--foreground)' }}>
                  Completed Trainings
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {user.trainings.map((training) => (
                    <div
                      key={training.id}
                      className="p-4 rounded-lg border"
                      style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)' }}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <h3 className="font-semibold text-lg" style={{ color: 'var(--foreground)' }}>
                            {training.trainingName}
                          </h3>
                          {training.trainingDescription && (
                            <p className="text-sm mt-1 opacity-80" style={{ color: 'var(--foreground)' }}>
                              {training.trainingDescription}
                            </p>
                          )}
                          <div className="flex flex-wrap gap-2 mt-2">
                            {training.trainingCategoryName && (
                              <span
                                className="text-xs px-2 py-1 rounded"
                                style={{ backgroundColor: 'var(--primary)', color: 'var(--primary-foreground)' }}
                              >
                                {training.trainingCategoryName}
                              </span>
                            )}
                            {training.trainingDuration && (
                              <span
                                className="text-xs px-2 py-1 rounded"
                                style={{ backgroundColor: 'var(--muted)', color: 'var(--muted-foreground)' }}
                              >
                                {training.trainingDuration} minutes
                              </span>
                            )}
                            {training.needsRetraining && (
                              <span className="text-xs px-2 py-1 rounded bg-red-500 text-white">
                                Retraining Required
                              </span>
                            )}
                          </div>
                          <p className="text-xs mt-2 opacity-60" style={{ color: 'var(--foreground)' }}>
                            Completed: {new Date(training.completedAt).toLocaleDateString()}
                          </p>
                          <p className="text-xs opacity-60" style={{ color: 'var(--foreground)' }}>
                            Trainer: {training.trainerUsername || 'Unknown'}
                          </p>
                        </div>
                        <div className="ml-2">
                          <svg className="w-8 h-8" fill="var(--primary)" viewBox="0 0 20 20">
                            <path
                              fillRule="evenodd"
                              d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                              clipRule="evenodd"
                            />
                          </svg>
                        </div>
                      </div>
                    </div>
                  ))}
                  {user.trainings.length === 0 && (
                    <p className="col-span-2 text-center py-8 opacity-60" style={{ color: 'var(--foreground)' }}>
                      No completed trainings yet
                    </p>
                  )}
                </div>
              </div>

              {requestRows.length > 0 && (
                <div className="p-6 rounded-lg border" style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)' }}>
                  <h2 className="text-xl font-semibold mb-4" style={{ color: 'var(--foreground)' }}>
                    Training Requests
                  </h2>
                  <div className="space-y-3">
                    {requestRows.map((request) => (
                      <div
                        key={request.id}
                        className="p-4 rounded-lg border"
                        style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)' }}
                      >
                        <div className="flex justify-between items-start">
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <h3 className="font-semibold" style={{ color: 'var(--foreground)' }}>
                                {request.trainingName}
                              </h3>
                              <span
                                className={`text-xs px-2 py-1 rounded ${
                                  request.status === 'pending'
                                    ? 'bg-yellow-500 text-white'
                                    : request.status === 'approved'
                                    ? 'bg-green-500 text-white'
                                    : request.status === 'rejected'
                                    ? 'bg-red-500 text-white'
                                    : 'bg-blue-500 text-white'
                                }`}
                              >
                                {request.status.toUpperCase()}
                              </span>
                            </div>
                            {request.requestMessage && (
                              <p className="text-sm mt-1" style={{ color: 'var(--foreground)' }}>
                                Your message: {request.requestMessage}
                              </p>
                            )}
                            {request.adminResponse && (
                              <p className="text-sm mt-1" style={{ color: 'var(--foreground)' }}>
                                Admin response: {request.adminResponse}
                              </p>
                            )}
                            <p className="text-xs mt-2 opacity-60" style={{ color: 'var(--foreground)' }}>
                              Requested: {new Date(request.requestedAt).toLocaleDateString()}
                            </p>
                          </div>
                          {request.status === 'pending' && (
                            <button
                              onClick={async () => {
                                setIsCancellingRequestId(request.id);
                                try {
                                  const response = await fetch(`/api/training-requests/${request.id}`, {
                                    method: 'DELETE',
                                  });

                                  if (!response.ok) {
                                    const data = await response.json().catch(() => ({}));
                                    throw new Error(data.error || 'Failed to cancel request');
                                  }

                                  setRequestRows((prev) => prev.filter((item) => item.id !== request.id));
                                  showSuccess('Training request cancelled');
                                  router.refresh();
                                } catch (error) {
                                  showError(error instanceof Error ? error.message : 'Failed to cancel request');
                                } finally {
                                  setIsCancellingRequestId(null);
                                }
                              }}
                              disabled={isCancellingRequestId === request.id}
                              className="px-3 py-1 text-sm rounded transition-colors disabled:opacity-50"
                              style={{
                                backgroundColor: 'var(--destructive)',
                                color: 'var(--destructive-foreground)',
                              }}
                            >
                              {isCancellingRequestId === request.id ? 'Cancelling…' : 'Cancel'}
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {trainingsViewTab === 'available' && (
            <div
              className="p-6 rounded-lg border"
              style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)' }}
            >
              {availableTrainings.length === 0 ? (
                <p className="opacity-60" style={{ color: 'var(--foreground)' }}>
                  No available trainings at this time. You&apos;ve completed all available trainings!
                </p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {availableTrainings.map((training) => {
                    const isLocked = !training.canRequest;
                    return (
                      <div
                        key={training.id}
                        className="p-4 rounded-lg border relative"
                        style={{
                          backgroundColor: 'var(--background)',
                          borderColor: 'var(--border)',
                          opacity: isLocked ? 0.7 : 1,
                        }}
                      >
                        <h3 className="font-semibold text-lg" style={{ color: 'var(--foreground)' }}>
                          {training.name}
                        </h3>
                        {training.description && (
                          <p className="text-sm mt-1 opacity-80" style={{ color: 'var(--foreground)' }}>
                            {training.description}
                          </p>
                        )}
                        <div className="flex flex-wrap gap-2 mt-2">
                          {training.categoryName && (
                            <span
                              className="text-xs px-2 py-1 rounded"
                              style={{ backgroundColor: 'var(--muted)', color: 'var(--muted-foreground)' }}
                            >
                              {training.categoryName}
                            </span>
                          )}
                          {training.duration && (
                            <span
                              className="text-xs px-2 py-1 rounded"
                              style={{ backgroundColor: 'var(--muted)', color: 'var(--muted-foreground)' }}
                            >
                              {training.duration} minutes
                            </span>
                          )}
                        </div>

                        {training.missingRank && (
                          <p className="text-xs mt-2" style={{ color: 'var(--destructive)' }}>
                            Requires rank: {training.missingRank.abbreviation} ({training.missingRank.name})
                          </p>
                        )}
                        {training.missingTrainings.length > 0 && (
                          <p className="text-xs mt-1" style={{ color: 'var(--destructive)' }}>
                            Missing trainings: {training.missingTrainings.map((item) => item.name).join(', ')}
                          </p>
                        )}

                        {selectedTrainingId === training.id && training.canRequest ? (
                          <div className="mt-3 space-y-2">
                            <textarea
                              value={requestMessage}
                              onChange={(event) => setRequestMessage(event.target.value)}
                              placeholder="Why do you want this training? (optional)"
                              rows={3}
                              className="w-full px-3 py-2 rounded border text-sm"
                              style={{
                                backgroundColor: 'var(--background)',
                                borderColor: 'var(--border)',
                                color: 'var(--foreground)',
                              }}
                            />
                            <div className="flex gap-2">
                              <button
                                onClick={async () => {
                                  if (!selectedTrainingId) return;

                                  setIsSubmittingRequest(true);
                                  try {
                                    const response = await fetch('/api/training-requests', {
                                      method: 'POST',
                                      headers: { 'Content-Type': 'application/json' },
                                      body: JSON.stringify({
                                        trainingId: selectedTrainingId,
                                        requestMessage: requestMessage.trim() || null,
                                      }),
                                    });

                                    if (!response.ok) {
                                      const data = await response.json().catch(() => ({}));
                                      throw new Error(data.error || 'Failed to submit request');
                                    }

                                    const created = await response.json();
                                    setRequestRows((prev) => [
                                      {
                                        id: created.id,
                                        trainingId: created.trainingId,
                                        trainingName: created.training.name,
                                        status: created.status,
                                        requestMessage: created.requestMessage,
                                        adminResponse: created.adminResponse,
                                        requestedAt: created.requestedAt,
                                        updatedAt: created.updatedAt,
                                        handledByAdminUsername: null,
                                      },
                                      ...prev,
                                    ]);

                                    setSelectedTrainingId(0);
                                    setRequestMessage('');
                                    showSuccess('Training request submitted');
                                    router.refresh();
                                  } catch (error) {
                                    showError(error instanceof Error ? error.message : 'Failed to submit request');
                                  } finally {
                                    setIsSubmittingRequest(false);
                                  }
                                }}
                                disabled={isSubmittingRequest}
                                className="px-4 py-2 rounded font-medium transition-colors disabled:opacity-50"
                                style={{ backgroundColor: 'var(--primary)', color: 'var(--primary-foreground)' }}
                              >
                                {isSubmittingRequest ? 'Submitting…' : 'Submit Request'}
                              </button>
                              <button
                                onClick={() => {
                                  setSelectedTrainingId(0);
                                  setRequestMessage('');
                                }}
                                className="px-4 py-2 rounded font-medium"
                                style={{ backgroundColor: 'var(--muted)', color: 'var(--foreground)' }}
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button
                            disabled={!training.canRequest || isSubmittingRequest}
                            onClick={() => {
                              setSelectedTrainingId(training.id);
                              setRequestMessage('');
                            }}
                            className="mt-3 px-4 py-2 rounded font-medium transition-colors disabled:opacity-50"
                            style={{
                              backgroundColor: training.canRequest ? 'var(--primary)' : 'var(--muted)',
                              color: training.canRequest ? 'var(--primary-foreground)' : 'var(--muted-foreground)',
                            }}
                          >
                            {training.canRequest ? 'Request Training' : 'Requirements Not Met'}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {activeTab === 'loa' && (
        <div className="space-y-4">
          <div className="rounded-lg border p-4 sm:p-6" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--secondary)' }}>
            <h3 className="font-semibold mb-3" style={{ color: 'var(--foreground)' }}>
              Submit Leave Of Absence
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>
                  Start Date
                </label>
                <input
                  type="date"
                  value={loaStartDate}
                  onChange={(event) => setLoaStartDate(event.target.value)}
                  className="mt-1 w-full px-3 py-2 rounded border text-sm"
                  style={{
                    backgroundColor: 'var(--background)',
                    borderColor: 'var(--border)',
                    color: 'var(--foreground)',
                  }}
                />
              </div>
              <div>
                <label className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>
                  Return Date (Optional)
                </label>
                <input
                  type="date"
                  value={loaReturnDate}
                  onChange={(event) => setLoaReturnDate(event.target.value)}
                  className="mt-1 w-full px-3 py-2 rounded border text-sm"
                  style={{
                    backgroundColor: 'var(--background)',
                    borderColor: 'var(--border)',
                    color: 'var(--foreground)',
                  }}
                />
              </div>
            </div>

            <div className="mt-3">
              <label className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>
                Reason (Optional)
              </label>
              <textarea
                value={loaReason}
                onChange={(event) => setLoaReason(event.target.value)}
                rows={3}
                placeholder="Reason for your leave"
                className="mt-1 w-full px-3 py-2 rounded border text-sm"
                style={{
                  backgroundColor: 'var(--background)',
                  borderColor: 'var(--border)',
                  color: 'var(--foreground)',
                }}
              />
            </div>

            <div className="mt-3 flex gap-2">
              <button
                disabled={isSubmittingLoa}
                onClick={async () => {
                  if (!loaStartDate) {
                    showError('Start date is required');
                    return;
                  }

                  setIsSubmittingLoa(true);
                  try {
                    const response = await fetch('/api/loa', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        startDate: loaStartDate,
                        returnDate: loaReturnDate || null,
                        reason: loaReason.trim() || null,
                      }),
                    });

                    if (!response.ok) {
                      const data = await response.json().catch(() => ({}));
                      throw new Error(data.error || 'Failed to submit LOA');
                    }

                    const created = await response.json();
                    setLoaRows((prev) => [created, ...prev]);
                    setLoaStartDate('');
                    setLoaReturnDate('');
                    setLoaReason('');
                    showSuccess('LOA submitted');
                    router.refresh();
                  } catch (error) {
                    showError(error instanceof Error ? error.message : 'Failed to submit LOA');
                  } finally {
                    setIsSubmittingLoa(false);
                  }
                }}
                className="px-4 py-2 rounded font-medium disabled:opacity-50"
                style={{ backgroundColor: 'var(--primary)', color: 'var(--primary-foreground)' }}
              >
                {isSubmittingLoa ? 'Submitting…' : 'Submit LOA'}
              </button>
            </div>
          </div>

          <div className="rounded-lg border p-4 sm:p-6" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--secondary)' }}>
            <h3 className="font-semibold mb-3" style={{ color: 'var(--foreground)' }}>
              My LOA Entries
            </h3>

            {loaRows.length === 0 ? (
              <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>
                No LOA entries yet.
              </p>
            ) : (
              <div className="space-y-3">
                {loaRows.map((entry) => {
                  const now = new Date();
                  const startDateObj = new Date(entry.startDate);
                  const returnDateObj = entry.returnDate ? new Date(entry.returnDate) : null;
                  const isCancelled = !!entry.cancelledAt;
                  const isReadOnly = isCancelled;
                  const isFuture = !isCancelled && startDateObj > now;
                  const isActive = !isCancelled && startDateObj <= now && (!returnDateObj || returnDateObj >= now);
                  const draftReturnDate = loaReturnDateDrafts[entry.id] ?? (entry.returnDate ? entry.returnDate.slice(0, 10) : '');
                  return (
                    <div
                      key={entry.id}
                      className="rounded border p-4"
                      style={{
                        backgroundColor: isReadOnly ? 'var(--muted)' : 'var(--background)',
                        borderColor: 'var(--border)',
                      }}
                    >
                      <div className="flex flex-col gap-2">
                        <p className="text-sm" style={{ color: 'var(--foreground)' }}>
                          <span className="font-semibold">Start:</span>{' '}
                          {new Date(entry.startDate).toLocaleDateString('en-GB')}
                        </p>
                        <p className="text-sm" style={{ color: 'var(--foreground)' }}>
                          <span className="font-semibold">Return:</span>{' '}
                          {entry.returnDate ? new Date(entry.returnDate).toLocaleDateString('en-GB') : 'Not set yet'}
                        </p>
                        {isCancelled && (
                          <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>
                            <span className="font-semibold">Status:</span> Cancelled
                          </p>
                        )}
                        {entry.reason && (
                          <p className="text-sm" style={{ color: 'var(--foreground)' }}>
                            <span className="font-semibold">Reason:</span> {entry.reason}
                          </p>
                        )}
                        <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-2 items-end mt-2">
                          <div>
                            <label className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
                              Set/Update Return Date
                            </label>
                            <input
                              type="date"
                              value={draftReturnDate}
                              disabled={isReadOnly}
                              onChange={(event) => {
                                const nextValue = event.target.value;
                                setLoaReturnDateDrafts((prev) => ({
                                  ...prev,
                                  [entry.id]: nextValue,
                                }));
                              }}
                              className="mt-1 w-full px-3 py-2 rounded border text-sm"
                              style={{
                                backgroundColor: isReadOnly ? 'var(--muted)' : 'var(--background)',
                                borderColor: 'var(--border)',
                                color: isReadOnly ? 'var(--muted-foreground)' : 'var(--foreground)',
                              }}
                            />
                          </div>
                          <button
                            disabled={isReadOnly || isSavingLoaId === entry.id}
                            onClick={async () => {
                              setIsSavingLoaId(entry.id);
                              try {
                                const response = await fetch(`/api/loa/${entry.id}`, {
                                  method: 'PATCH',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ returnDate: draftReturnDate || null }),
                                });

                                if (!response.ok) {
                                  const data = await response.json().catch(() => ({}));
                                  throw new Error(data.error || 'Failed to update LOA return date');
                                }

                                const updated = await response.json();
                                setLoaRows((prev) => prev.map((row) => (row.id === entry.id ? updated : row)));
                                showSuccess('LOA return date updated');
                                router.refresh();
                              } catch (error) {
                                showError(error instanceof Error ? error.message : 'Failed to update LOA return date');
                              } finally {
                                setIsSavingLoaId(null);
                              }
                            }}
                            className="px-3 py-2 rounded text-sm font-medium disabled:opacity-50"
                            style={{ backgroundColor: 'var(--primary)', color: 'var(--primary-foreground)' }}
                          >
                            {isSavingLoaId === entry.id ? 'Saving…' : 'Save Return Date'}
                          </button>
                          <button
                            disabled={(!isActive && !isFuture) || !!entry.returnDate || isMarkingBackLoaId === entry.id || isCancellingLoaId === entry.id}
                            onClick={async () => {
                              if (isFuture) {
                                setIsCancellingLoaId(entry.id);
                                try {
                                  const response = await fetch(`/api/loa/${entry.id}`, {
                                    method: 'PATCH',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ cancel: true }),
                                  });

                                  if (!response.ok) {
                                    const data = await response.json().catch(() => ({}));
                                    throw new Error(data.error || 'Failed to cancel LOA');
                                  }

                                  const updated = await response.json();
                                  setLoaRows((prev) => prev.map((row) => (row.id === entry.id ? updated : row)));
                                  showSuccess('Future LOA cancelled');
                                  router.refresh();
                                } catch (error) {
                                  showError(error instanceof Error ? error.message : 'Failed to cancel LOA');
                                } finally {
                                  setIsCancellingLoaId(null);
                                }
                                return;
                              }

                              setIsMarkingBackLoaId(entry.id);
                              try {
                                const today = new Date().toISOString().slice(0, 10);
                                const startDate = entry.startDate.slice(0, 10);
                                const returnDateToSet = today >= startDate ? today : startDate;
                                const response = await fetch(`/api/loa/${entry.id}`, {
                                  method: 'PATCH',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ returnDate: returnDateToSet }),
                                });

                                if (!response.ok) {
                                  const data = await response.json().catch(() => ({}));
                                  throw new Error(data.error || 'Failed to mark LOA as returned');
                                }

                                const updated = await response.json();
                                setLoaRows((prev) => prev.map((row) => (row.id === entry.id ? updated : row)));
                                setLoaReturnDateDrafts((prev) => ({
                                  ...prev,
                                  [entry.id]: returnDateToSet,
                                }));
                                showSuccess('Marked as back now');
                                router.refresh();
                              } catch (error) {
                                showError(error instanceof Error ? error.message : 'Failed to mark LOA as returned');
                              } finally {
                                setIsMarkingBackLoaId(null);
                              }
                            }}
                            className="px-3 py-2 rounded text-sm font-medium disabled:opacity-50"
                            style={{
                              backgroundColor: isFuture ? 'var(--destructive)' : 'var(--muted)',
                              color: isFuture ? 'var(--destructive-foreground)' : 'var(--foreground)',
                            }}
                          >
                            {isMarkingBackLoaId === entry.id || isCancellingLoaId === entry.id
                              ? 'Updating…'
                              : isFuture
                                ? 'Cancel LOA'
                                : "I'm Back Now"}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'actions' && (
        <div className="rounded-lg border p-4" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--secondary)' }}>
          <h3 className="font-semibold mb-3" style={{ color: 'var(--foreground)' }}>Profile Actions</h3>

          <div className="space-y-3 max-w-2xl">
            <label className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>
              Upload Profile Picture
            </label>
            <input
              ref={avatarFileInputRef}
              type="file"
              accept="image/*"
              className="w-full px-3 py-2 rounded border text-sm"
              style={{
                borderColor: 'var(--border)',
                backgroundColor: 'var(--background)',
                color: 'var(--foreground)',
              }}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (!file) {
                  setSelectedAvatarFileName(null);
                  return;
                }

                const maxBytes = 2 * 1024 * 1024;
                const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
                
                if (!allowedTypes.includes(file.type)) {
                  showError('Invalid file type. Allowed: JPEG, PNG, GIF, WebP');
                  event.currentTarget.value = '';
                  setSelectedAvatarFileName(null);
                  return;
                }

                if (file.size > maxBytes) {
                  showError('Image must be 2MB or smaller');
                  event.currentTarget.value = '';
                  setSelectedAvatarFileName(null);
                  return;
                }

                // Create preview using FileReader
                const reader = new FileReader();
                reader.onload = () => {
                  const result = typeof reader.result === 'string' ? reader.result : null;
                  if (!result) {
                    showError('Failed to read image file');
                    return;
                  }
                  setProfileImageUrl(result);
                  setSelectedAvatarFileName(file.name);
                };
                reader.onerror = () => {
                  showError('Failed to read image file');
                };
                reader.readAsDataURL(file);
              }}
            />
            <p className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
              {selectedAvatarFileName ? `Selected: ${selectedAvatarFileName}` : 'Choose an image file (JPEG, PNG, GIF, WebP - max 2MB)'}
            </p>
            <div className="flex gap-2">
              <button
                disabled={isSavingAvatar || !selectedAvatarFileName}
                onClick={async () => {
                  setIsSavingAvatar(true);
                  try {
                    const fileInput = avatarFileInputRef.current;
                    if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
                      throw new Error('No file selected');
                    }

                    const file = fileInput.files[0];
                    const formData = new FormData();
                    formData.append('file', file);

                    const response = await fetch('/api/user/avatar/upload', {
                      method: 'POST',
                      body: formData,
                    });

                    if (!response.ok) {
                      const data = await response.json().catch(() => ({}));
                      throw new Error(data.error || 'Failed to upload profile picture');
                    }

                    const result = await response.json();
                    
                    showSuccess('Profile picture updated');
                    await updateSession();
                    if (avatarFileInputRef.current) {
                      avatarFileInputRef.current.value = '';
                    }
                    setSelectedAvatarFileName(null);
                    setProfileImageUrl(result.avatarUrl || '');
                    router.refresh();
                  } catch (error) {
                    showError(error instanceof Error ? error.message : 'Failed to upload profile picture');
                  } finally {
                    setIsSavingAvatar(false);
                  }
                }}
                className="px-3 py-2 rounded text-sm font-medium disabled:opacity-50"
                style={{ backgroundColor: 'var(--primary)', color: 'var(--primary-foreground)' }}
              >
                {isSavingAvatar ? 'Uploading…' : 'Upload Picture'}
              </button>
              <button
                disabled={isSavingAvatar}
                onClick={async () => {
                  setIsSavingAvatar(true);
                  try {
                    const response = await fetch('/api/user/update', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ avatarUrl: null }),
                    });

                    if (!response.ok) {
                      const data = await response.json().catch(() => ({}));
                      throw new Error(data.error || 'Failed to clear profile picture');
                    }

                    setProfileImageUrl('');
                    if (avatarFileInputRef.current) {
                      avatarFileInputRef.current.value = '';
                    }
                    setSelectedAvatarFileName(null);
                    showSuccess('Profile picture cleared');
                    await updateSession();
                    router.refresh();
                  } catch (error) {
                    showError(error instanceof Error ? error.message : 'Failed to clear profile picture');
                  } finally {
                    setIsSavingAvatar(false);
                  }
                }}
                className="px-3 py-2 rounded text-sm font-medium disabled:opacity-50"
                style={{ backgroundColor: 'var(--muted)', color: 'var(--foreground)' }}
              >
                Clear
              </button>
            </div>

            <div className="pt-2 flex flex-wrap gap-2">
              <button
                disabled={!user.providers.includes('discord') || isSavingAvatar || isRefreshingSteamAvatar}
                onClick={() => {
                  document.cookie = 'discord-avatar-refresh=1; Path=/; Max-Age=300; SameSite=Lax';
                  signIn('discord', { callbackUrl: '/profile' });
                }}
                className="px-3 py-2 rounded text-sm font-medium disabled:opacity-50"
                style={{ backgroundColor: 'var(--primary)', color: 'var(--primary-foreground)' }}
              >
                Re-auth with Discord
              </button>

              <button
                disabled={isRefreshingSteamAvatar || isSavingAvatar || !user.providers.includes('steam')}
                onClick={async () => {
                  setIsRefreshingSteamAvatar(true);
                  try {
                    const response = await fetch('/api/user/avatar/refresh', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ provider: 'steam' }),
                    });

                    if (!response.ok) {
                      const data = await response.json().catch(() => ({}));
                      throw new Error(data.error || 'Failed to refresh from Steam');
                    }

                    const data = await response.json();
                    if (data.avatarUrl) {
                      setProfileImageUrl(data.avatarUrl);
                    }
                    showSuccess('Profile picture refreshed from Steam');
                    await updateSession();
                    router.refresh();
                  } catch (error) {
                    showError(error instanceof Error ? error.message : 'Failed to refresh from Steam');
                  } finally {
                    setIsRefreshingSteamAvatar(false);
                  }
                }}
                className="px-3 py-2 rounded text-sm font-medium disabled:opacity-50"
                style={{ backgroundColor: 'var(--secondary)', color: 'var(--foreground)', border: '1px solid var(--border)' }}
              >
                {isRefreshingSteamAvatar ? 'Refreshing…' : 'Refresh from Steam'}
              </button>
            </div>

            {profileImageUrl?.startsWith('data:') && (
              <div className="mt-3 p-3 rounded border" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--muted)' }}>
                <p className="text-sm mb-2" style={{ color: 'var(--foreground)' }}>
                  <strong>Note:</strong> Your current avatar is stored as a data URL. 
                  Consider uploading a new image to use the more efficient file storage.
                </p>
                <button
                  disabled={isSavingAvatar}
                  onClick={async () => {
                    setIsSavingAvatar(true);
                    try {
                      const response = await fetch('/api/user/avatar/migrate', {
                        method: 'POST',
                      });

                      if (!response.ok) {
                        const data = await response.json().catch(() => ({}));
                        throw new Error(data.error || 'Failed to migrate avatar');
                      }

                      const result = await response.json();
                      if (result.migrated) {
                        showSuccess('Avatar migrated to file storage');
                        setProfileImageUrl(result.newAvatarUrl || '');
                        await updateSession();
                        router.refresh();
                      } else {
                        showSuccess(result.message || 'Avatar is already using file storage');
                      }
                    } catch (error) {
                      showError(error instanceof Error ? error.message : 'Failed to migrate avatar');
                    } finally {
                      setIsSavingAvatar(false);
                    }
                  }}
                  className="px-3 py-2 rounded text-sm font-medium disabled:opacity-50"
                  style={{ backgroundColor: 'var(--primary)', color: 'var(--primary-foreground)' }}
                >
                  {isSavingAvatar ? 'Migrating…' : 'Migrate to File Storage'}
                </button>
              </div>
            )}
            <p className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
              Refresh buttons require linked provider accounts.
            </p>
          </div>
        </div>
      )}

      {activeTab === 'rank-history' && (
        <div className="rounded-lg border p-4 sm:p-6" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--secondary)' }}>
          <h3 className="font-semibold mb-3" style={{ color: 'var(--foreground)' }}>Rank History</h3>

          {rankHistoryError && (
            <div
              className="mb-4 p-3 rounded border text-sm"
              style={{
                backgroundColor: 'var(--destructive)',
                color: 'var(--destructive-foreground)',
                borderColor: 'var(--destructive)',
              }}
            >
              {rankHistoryError}
            </div>
          )}

          {isLoadingRankHistory ? (
            <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>Loading rank history…</p>
          ) : rankHistoryRows.length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>No rank history yet</p>
          ) : (
            <div className="space-y-3">
              {rankHistoryRows.map((entry) => (
                <div
                  key={entry.id}
                  className="border rounded-lg p-4"
                  style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)' }}
                >
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs px-2 py-1 rounded font-semibold" style={{ backgroundColor: 'var(--muted)', color: 'var(--foreground)' }}>
                        {entry.previousRankName || 'Unranked'} → {entry.newRankName}
                      </span>
                      <span
                        className="text-xs px-2 py-1 rounded font-semibold"
                        style={{
                          backgroundColor:
                            entry.outcome === 'approved'
                              ? 'var(--primary)'
                              : entry.outcome === 'declined'
                                ? 'var(--destructive)'
                                : 'var(--muted)',
                          color:
                            entry.outcome === 'approved'
                              ? 'var(--primary-foreground)'
                              : entry.outcome === 'declined'
                                ? 'var(--destructive-foreground)'
                                : 'var(--foreground)',
                        }}
                      >
                        {entry.outcome?.toUpperCase() || 'PENDING'}
                      </span>
                    </div>
                    <span className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
                      {new Date(entry.createdAt).toLocaleDateString('en-US', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>

                  <div className="space-y-1 text-sm" style={{ color: 'var(--muted-foreground)' }}>
                    <p>
                      Attendance: {entry.attendanceDeltaSinceLastRank} ops since last rank (Total: {entry.attendanceTotalAtChange})
                    </p>
                    <p>
                      Triggered by: <span style={{ textTransform: 'capitalize' }}>{entry.triggeredBy}</span>
                    </p>
                    {entry.declineReason && (
                      <p>
                        Decline reason: <em>{entry.declineReason}</em>
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {rankHistoryPagination && rankHistoryPagination.totalPages > 1 && (
            <div className="mt-4 flex justify-center gap-2">
              <button
                onClick={() => setRankHistoryPage(Math.max(1, rankHistoryPage - 1))}
                disabled={rankHistoryPage === 1 || isLoadingRankHistory}
                className="px-3 py-2 rounded-md border disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }}
              >
                Previous
              </button>
              <div style={{ color: 'var(--muted-foreground)' }} className="px-3 py-2 text-sm">
                Page {rankHistoryPage} of {rankHistoryPagination.totalPages}
              </div>
              <button
                onClick={() => setRankHistoryPage(Math.min(rankHistoryPagination.totalPages, rankHistoryPage + 1))}
                disabled={rankHistoryPage === rankHistoryPagination.totalPages || isLoadingRankHistory}
                className="px-3 py-2 rounded-md border disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }}
              >
                Next
              </button>
            </div>
          )}
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
