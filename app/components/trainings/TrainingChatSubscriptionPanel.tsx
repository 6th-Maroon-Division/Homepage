'use client';

import { useEffect, useState } from 'react';
import LoadingSpinner from '@/app/components/ui/LoadingSpinner';
import { useToast } from '@/app/components/ui/ToastContainer';
import type { TrainingChatSubscription } from './training-request-types';

export default function TrainingChatSubscriptionPanel({
  requestId,
  initialSubscription,
  isStaff,
}: {
  requestId: number;
  initialSubscription: TrainingChatSubscription;
  isStaff: boolean;
}) {
  const { showError, showSuccess } = useToast();
  const [websiteEnabled, setWebsiteEnabled] = useState(initialSubscription.website);
  const [discordEnabled, setDiscordEnabled] = useState(initialSubscription.discord);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setWebsiteEnabled(initialSubscription.website);
    setDiscordEnabled(initialSubscription.discord);
  }, [initialSubscription.discord, initialSubscription.website]);

  const save = async () => {
    setIsSaving(true);
    try {
      const response = await fetch(`/api/training-requests/${requestId}/subscription`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ websiteEnabled, discordEnabled }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || 'Failed to update notification subscription');
      }

      showSuccess('Chat notification preferences saved');
    } catch (error) {
      showError(error instanceof Error ? error.message : 'Failed to update notification subscription');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section
      className="rounded-lg border p-4"
      style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)' }}
    >
      <h2 className="font-semibold" style={{ color: 'var(--foreground)' }}>Chat Notifications</h2>
      <p className="mb-3 text-xs" style={{ color: 'var(--muted-foreground)' }}>
        {isStaff
          ? 'Subscribe to this request without assigning yourself as its trainer.'
          : 'Choose how you want to be notified when staff replies.'}
      </p>

      <div className="space-y-2">
        <label className="flex cursor-pointer items-start gap-3 rounded-md border p-3" style={{ borderColor: 'var(--border)' }}>
          <input
            type="checkbox"
            checked={websiteEnabled}
            onChange={(event) => setWebsiteEnabled(event.target.checked)}
            className="mt-0.5 h-4 w-4"
          />
          <span>
            <span className="block text-sm font-medium" style={{ color: 'var(--foreground)' }}>Website</span>
            <span className="block text-xs" style={{ color: 'var(--muted-foreground)' }}>Show new messages in the website inbox.</span>
          </span>
        </label>
        <label className="flex cursor-pointer items-start gap-3 rounded-md border p-3" style={{ borderColor: 'var(--border)' }}>
          <input
            type="checkbox"
            checked={discordEnabled}
            onChange={(event) => setDiscordEnabled(event.target.checked)}
            className="mt-0.5 h-4 w-4"
          />
          <span>
            <span className="block text-sm font-medium" style={{ color: 'var(--foreground)' }}>Discord</span>
            <span className="block text-xs" style={{ color: 'var(--muted-foreground)' }}>
              Receive a Discord DM when {isStaff ? 'the user' : 'staff'} replies.
            </span>
          </span>
        </label>
      </div>

      <button
        type="button"
        onClick={() => void save()}
        disabled={isSaving}
        className="mt-3 inline-flex min-w-36 items-center justify-center rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
        style={{ backgroundColor: 'var(--primary)', color: 'var(--primary-foreground)' }}
      >
        {isSaving ? <LoadingSpinner size="sm" /> : 'Save Preferences'}
      </button>
    </section>
  );
}
