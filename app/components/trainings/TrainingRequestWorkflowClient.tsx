'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import LoadingSpinner from '@/app/components/ui/LoadingSpinner';
import TrainingChatSubscriptionPanel from './TrainingChatSubscriptionPanel';
import TrainingRequestChat from './TrainingRequestChat';
import TrainingSchedulePanel from './TrainingSchedulePanel';
import TrainingScheduleSummary, { isConfirmedTrainingSession } from './TrainingScheduleSummary';
import TrainingStatusActionPanel from './TrainingStatusActionPanel';
import TrainingStatusBadge from './TrainingStatusBadge';
import {
  normalizeTrainingRequestDetail,
  type TrainingRequestDetail,
  type TrainingRequestMessage,
} from './training-request-types';

export default function TrainingRequestWorkflowClient({
  requestId,
  currentUserId,
  initialIsStaff,
}: {
  requestId: number;
  currentUserId: number;
  initialIsStaff: boolean;
}) {
  const [request, setRequest] = useState<TrainingRequestDetail | null>(null);
  const [isStaff, setIsStaff] = useState(initialIsStaff);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadRequest = useCallback(async (showLoader = false) => {
    if (showLoader) setIsLoading(true);
    try {
      const response = await fetch(`/api/training-requests/${requestId}`, { cache: 'no-store' });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || (response.status === 404 ? 'Training request not found' : 'Unable to load training request'));
      }

      const payload = await response.json();
      const normalized = normalizeTrainingRequestDetail(payload);
      setRequest(normalized);
      setIsStaff(Boolean(payload.isStaff ?? payload.canManage ?? initialIsStaff));
      setError('');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load training request');
    } finally {
      if (showLoader) setIsLoading(false);
    }
  }, [initialIsStaff, requestId]);

  const queueRefresh = useCallback(() => {
    if (refreshTimerRef.current) return;
    refreshTimerRef.current = setTimeout(() => {
      refreshTimerRef.current = null;
      void loadRequest(false);
    }, 250);
  }, [loadRequest]);

  useEffect(() => {
    void loadRequest(true);
    return () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, [loadRequest]);

  const updateMessages = useCallback((messages: TrainingRequestMessage[]) => {
    setRequest((current) => current ? { ...current, messages } : current);
  }, []);

  if (isLoading) {
    return (
      <div className="flex min-h-72 items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (error || !request) {
    return (
      <div className="rounded-lg border p-8 text-center" style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)' }}>
        <h1 className="text-xl font-semibold" style={{ color: 'var(--foreground)' }}>Unable to open request</h1>
        <p className="mt-2 text-sm" style={{ color: 'var(--muted-foreground)' }}>{error || 'Training request not found'}</p>
        <Link href={initialIsStaff ? '/admin/trainings' : '/profile'} className="mt-4 inline-block text-sm" style={{ color: 'var(--primary)' }}>
          ← Back to trainings
        </Link>
      </div>
    );
  }

  const confirmedSession = isConfirmedTrainingSession(request.session) ? request.session : null;

  return (
    <div className="space-y-5">
      <section
        className="flex flex-col gap-3 rounded-lg border p-5 sm:flex-row sm:items-start sm:justify-between"
        style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)' }}
      >
        <div>
          <Link href={isStaff ? '/admin/trainings' : '/profile'} className="text-sm" style={{ color: 'var(--primary)' }}>
            ← Back to trainings
          </Link>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold sm:text-3xl" style={{ color: 'var(--foreground)' }}>
              {request.training.name}
            </h1>
            <TrainingStatusBadge status={request.status} />
          </div>
          <p className="mt-1 text-sm" style={{ color: 'var(--muted-foreground)' }}>
            Request #{request.id}{isStaff ? ` · ${request.user?.username || `User ${request.userId}`}` : ''}
          </p>
        </div>
        <div className="text-sm sm:text-right" style={{ color: 'var(--muted-foreground)' }}>
          Requested {new Date(request.requestedAt).toLocaleString()}
        </div>
      </section>

      {!isStaff && request.status === 'pending' && (
        <div className="rounded-lg border p-4" style={{ backgroundColor: 'color-mix(in srgb, var(--primary) 12%, var(--background))', borderColor: 'var(--primary)' }}>
          <div className="font-semibold" style={{ color: 'var(--foreground)' }}>Your request has been received.</div>
          <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>
            Staff will contact you here to arrange the training. You can send a message at any time.
          </p>
        </div>
      )}

      {!isStaff && confirmedSession && (
        <TrainingScheduleSummary session={confirmedSession} revealTrainer />
      )}

      {!isStaff && !confirmedSession && request.session && (
        <div className="rounded-lg border p-4 text-sm" style={{ borderColor: 'var(--border)', color: 'var(--muted-foreground)' }}>
          Staff are preparing your schedule. Trainer and date details will appear here after confirmation.
        </div>
      )}

      <div className={`grid grid-cols-1 gap-5 ${isStaff ? 'xl:grid-cols-[minmax(0,1fr)_24rem]' : ''}`}>
        <div className="space-y-5">
          <TrainingRequestChat
            requestId={request.id}
            currentUserId={currentUserId}
            isStaff={isStaff}
            requestUsername={request.user?.username ?? null}
            initialMessages={request.messages}
            onMessagesChange={updateMessages}
            onInvalidate={queueRefresh}
          />

          {!isStaff && (
            <TrainingChatSubscriptionPanel
              requestId={request.id}
              initialSubscription={request.subscription}
              isStaff={false}
            />
          )}

          <section className="rounded-lg border p-4" style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)' }}>
            <h2 className="font-semibold" style={{ color: 'var(--foreground)' }}>Training Requirements</h2>
            <div className="mt-3 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              <div className="rounded-md border p-3" style={{ borderColor: 'var(--border)' }}>
                <div className="text-xs" style={{ color: 'var(--muted-foreground)' }}>Training session</div>
                <div className="font-medium" style={{ color: 'var(--foreground)' }}>
                  {request.training.requiresTrainingSession ? 'Required' : 'Not required'}
                </div>
              </div>
              <div className="rounded-md border p-3" style={{ borderColor: 'var(--border)' }}>
                <div className="text-xs" style={{ color: 'var(--muted-foreground)' }}>ORBAT qualification</div>
                <div className="font-medium" style={{ color: 'var(--foreground)' }}>
                  {request.training.requiresOrbatQualification ? 'Required' : 'Not required'}
                </div>
              </div>
            </div>
            {request.training.qualificationNotes && (
              <p className="mt-3 whitespace-pre-wrap rounded-md p-3 text-sm" style={{ backgroundColor: 'var(--muted)', color: 'var(--foreground)' }}>
                {request.training.qualificationNotes}
              </p>
            )}
          </section>
        </div>

        {isStaff && (
          <aside className="space-y-5">
            <TrainingStatusActionPanel
              requestId={request.id}
              status={request.status}
              requiresTrainingSession={request.training.requiresTrainingSession}
              requiresOrbatQualification={request.training.requiresOrbatQualification}
              onSaved={() => loadRequest(false)}
            />
            {request.training.requiresTrainingSession ? (
              <TrainingSchedulePanel
                requestId={request.id}
                requestUserId={request.userId}
                trainingId={request.training.id}
                session={request.session}
                defaultDurationMinutes={request.training.duration}
                onSaved={() => loadRequest(false)}
              />
            ) : (
              <section className="rounded-lg border p-4" style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)' }}>
                <h2 className="font-semibold" style={{ color: 'var(--foreground)' }}>Training Session</h2>
                <p className="mt-1 text-sm" style={{ color: 'var(--muted-foreground)' }}>
                  This training does not require a scheduled theoretical session.
                </p>
              </section>
            )}
            <TrainingChatSubscriptionPanel
              requestId={request.id}
              initialSubscription={request.subscription}
              isStaff
            />
          </aside>
        )}
      </div>
    </div>
  );
}
