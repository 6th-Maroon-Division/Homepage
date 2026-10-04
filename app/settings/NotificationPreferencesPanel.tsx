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

const groups: { title: string; description: string; fields: (keyof Preferences)[] }[] = [
  {
    title: 'Delivery methods',
    description: 'Choose how to receive the message types you enable below.',
    fields: ['dmEnabled', 'channelMentionsEnabled'],
  },
  {
    title: 'Message types',
    description: 'Choose which notifications you want through your selected delivery methods.',
    fields: ['orbatAnnouncements', 'trainingScheduled', 'trainingUpdated', 'trainingCancelled', 'trainingReminders', 'promotionAnnouncements'],
  },
];

export default function NotificationPreferencesPanel() {
  const [preferences, setPreferences] = useState<Preferences | null>(null);
  const [saving, setSaving] = useState(false);
  const { showError, showSuccess } = useToast();

  useEffect(() => {
    void fetch('/api/users/me/notification-preferences')
      .then(async (response) => {
        if (!response.ok) throw new Error('Failed to load notification preferences');
        setPreferences((await response.json()).data);
      })
      .catch((error) => showError(error instanceof Error ? error.message : 'Failed to load notification preferences'));
  }, [showError]);

  if (!preferences) return <p style={{ color: 'var(--muted-foreground)' }}>Loading notification preferences…</p>;

  return (
    <div className="space-y-5">
      <header className="rounded-lg border p-5" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--secondary)' }}>
      <h3 className="font-semibold" style={{ color: 'var(--foreground)' }}>Notification preferences</h3>
      <p className="mt-1 text-sm" style={{ color: 'var(--muted-foreground)' }}>
        These settings are shared with the Discord bot. Enable at least one delivery method and one message type to receive notifications.
      </p>
      </header>
      <div className="rounded-lg border" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--secondary)' }}>
        {groups.map((group) => (
          <section key={group.title} className="border-b p-5" style={{ borderColor: 'var(--border)' }}>
            <h4 id={`notification-${group.fields[0]}`} className="mb-2 font-semibold" style={{ color: 'var(--foreground)' }}>{group.title}</h4>
            <fieldset disabled={saving} aria-labelledby={`notification-${group.fields[0]}`}>
            <p className="mb-3 text-sm" style={{ color: 'var(--muted-foreground)' }}>{group.description}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {group.fields.map((field) => (
                <label key={field} className="flex items-center gap-3 rounded border p-3" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--background)' }}>
                  <input type="checkbox" checked={preferences[field]} onChange={(event) => setPreferences({ ...preferences, [field]: event.target.checked })} />
                  <span className="text-sm" style={{ color: 'var(--foreground)' }}>{labels[field]}</span>
                </label>
              ))}
            </div>
            </fieldset>
          </section>
        ))}
        <div className="p-5">
      <button
        className="rounded px-4 py-2 text-sm font-medium disabled:opacity-50"
        style={{ backgroundColor: 'var(--primary)', color: 'var(--primary-foreground)' }}
        disabled={saving}
        onClick={async () => {
          setSaving(true);
          try {
            const response = await fetch('/api/users/me/notification-preferences', {
              method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(Object.keys(labels).map(field => [field, preferences[field as keyof Preferences]]))),
            });
            if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error?.message || 'Failed to save preferences');
            setPreferences((await response.json()).data);
            showSuccess('Notification preferences saved');
          } catch (error) {
            showError(error instanceof Error ? error.message : 'Failed to save notification preferences');
          } finally { setSaving(false); }
        }}
      >{saving ? 'Saving…' : 'Save preferences'}</button>
        </div>
      </div>
    </div>
  );
}
