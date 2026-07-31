'use client';

import { useEffect, useState } from 'react';
import { useToast } from '@/app/components/ui/ToastContainer';

const labels = {
  orbatAnnouncements: 'ORBAT announcements',
  trainingScheduled: 'Training scheduled',
  trainingUpdated: 'Training updated',
  trainingCancelled: 'Training cancelled',
  trainingReminders: 'Training reminders',
  promotionAnnouncements: 'Promotion announcements',
  dmEnabled: 'Discord direct messages',
  channelMentionsEnabled: 'Discord channel mentions',
} as const;

type Preferences = Record<keyof typeof labels, boolean>;

export default function NotificationPreferencesPanel() {
  const [preferences, setPreferences] = useState<Preferences | null>(null);
  const [saving, setSaving] = useState(false);
  const { showError, showSuccess } = useToast();

  useEffect(() => {
    void fetch('/api/users/me/notification-preferences')
      .then(async (response) => {
        if (!response.ok) throw new Error('Failed to load notification preferences');
        setPreferences(await response.json());
      })
      .catch((error) => showError(error instanceof Error ? error.message : 'Failed to load notification preferences'));
  }, [showError]);

  if (!preferences) return <p style={{ color: 'var(--muted-foreground)' }}>Loading notification preferences…</p>;

  return (
    <div className="rounded-lg border p-4" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--secondary)' }}>
      <h3 className="font-semibold" style={{ color: 'var(--foreground)' }}>Notification preferences</h3>
      <p className="mt-1 mb-4 text-sm" style={{ color: 'var(--muted-foreground)' }}>
        These settings are shared with the Discord bot. Notifications are off until you enable them.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {(Object.keys(labels) as Array<keyof Preferences>).map((field) => (
          <label key={field} className="flex items-center gap-3 rounded border p-3" style={{ borderColor: 'var(--border)' }}>
            <input type="checkbox" checked={preferences[field]} onChange={(event) => setPreferences({ ...preferences, [field]: event.target.checked })} />
            <span className="text-sm" style={{ color: 'var(--foreground)' }}>{labels[field]}</span>
          </label>
        ))}
      </div>
      <button
        className="mt-4 rounded px-4 py-2 text-sm font-medium disabled:opacity-50"
        style={{ backgroundColor: 'var(--primary)', color: 'var(--primary-foreground)' }}
        disabled={saving}
        onClick={async () => {
          setSaving(true);
          try {
            const response = await fetch('/api/users/me/notification-preferences', {
              method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(preferences),
            });
            if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'Failed to save preferences');
            setPreferences(await response.json());
            showSuccess('Notification preferences saved');
          } catch (error) {
            showError(error instanceof Error ? error.message : 'Failed to save notification preferences');
          } finally { setSaving(false); }
        }}
      >{saving ? 'Saving…' : 'Save preferences'}</button>
    </div>
  );
}
