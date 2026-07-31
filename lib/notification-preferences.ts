import { prisma } from '@/lib/prisma';

export const NOTIFICATION_PREFERENCE_FIELDS = [
  'orbatAnnouncements',
  'trainingScheduled',
  'trainingUpdated',
  'trainingCancelled',
  'trainingReminders',
  'promotionAnnouncements',
  'dmEnabled',
  'channelMentionsEnabled',
] as const;

export type NotificationPreferenceField = typeof NOTIFICATION_PREFERENCE_FIELDS[number];

export function parseNotificationPatch(body: unknown):
  | { data: Partial<Record<NotificationPreferenceField, boolean>> }
  | { error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'Request body must be an object.' };
  const record = body as Record<string, unknown>;
  const allowed = new Set<string>(NOTIFICATION_PREFERENCE_FIELDS);
  const unknown = Object.keys(record).filter((key) => !allowed.has(key));
  if (unknown.length) return { error: `Unknown preference fields: ${unknown.join(', ')}` };
  const data: Partial<Record<NotificationPreferenceField, boolean>> = {};
  for (const field of NOTIFICATION_PREFERENCE_FIELDS) {
    if (!(field in record)) continue;
    if (typeof record[field] !== 'boolean') return { error: `${field} must be a boolean.` };
    data[field] = record[field] as boolean;
  }
  return { data };
}

export async function getOrCreateNotificationPreferences(userId: number) {
  return prisma.userNotificationPreference.upsert({
    where: { userId }, update: {}, create: { userId },
  });
}
