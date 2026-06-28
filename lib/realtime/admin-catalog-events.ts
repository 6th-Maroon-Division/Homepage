import { nextEventId, publishToChannel, subscribeToChannel } from '@/lib/realtime/event-hub';

export type AdminCatalogEventType =
  | 'orbat.changed'
  | 'template.changed'
  | 'role-definition.changed';

export type AdminCatalogEvent = {
  id: string;
  type: AdminCatalogEventType;
  occurredAt: string;
  actorUserId: number | null;
  payload?: Record<string, unknown>;
};

type AdminCatalogEventInput = {
  type: AdminCatalogEventType;
  actorUserId?: number | null;
  payload?: Record<string, unknown>;
};

type AdminCatalogEventListener = (event: AdminCatalogEvent) => void;

const ADMIN_CATALOG_CHANNEL = 'admin-catalog';
const ADMIN_CATALOG_SCOPE = 'all';

export function publishAdminCatalogEvent(input: AdminCatalogEventInput): AdminCatalogEvent {
  const event: AdminCatalogEvent = {
    id: nextEventId(ADMIN_CATALOG_CHANNEL),
    type: input.type,
    occurredAt: new Date().toISOString(),
    actorUserId: input.actorUserId ?? null,
    payload: input.payload,
  };

  publishToChannel(ADMIN_CATALOG_CHANNEL, ADMIN_CATALOG_SCOPE, event);
  return event;
}

export function subscribeAdminCatalogEvents(listener: AdminCatalogEventListener) {
  return subscribeToChannel(ADMIN_CATALOG_CHANNEL, ADMIN_CATALOG_SCOPE, listener);
}