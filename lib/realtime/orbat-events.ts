import { nextEventId, publishToChannel, subscribeToChannel } from '@/lib/realtime/event-hub';

export type OrbatEventType =
  | 'orbat.created'
  | 'orbat.updated'
  | 'orbat.deleted'
  | 'signup.created'
  | 'signup.deleted'
  | 'signup.moved';

export type OrbatEventVisibility = 'public' | 'staff';

export type OrbatEvent = {
  id: string;
  type: OrbatEventType;
  orbatId: number;
  occurredAt: string;
  visibility: OrbatEventVisibility;
  actorUserId: number | null;
  payload?: Record<string, unknown>;
};

type OrbatEventInput = {
  type: OrbatEventType;
  orbatId: number;
  visibility?: OrbatEventVisibility;
  actorUserId?: number | null;
  payload?: Record<string, unknown>;
};

const ORBAT_CHANNEL = 'orbat';
const ORBAT_ALL_SCOPE = 'all';
type OrbatEventListener = (event: OrbatEvent) => void;

export function publishOrbatEvent(input: OrbatEventInput): OrbatEvent {
  const event: OrbatEvent = {
    id: nextEventId(ORBAT_CHANNEL),
    type: input.type,
    orbatId: input.orbatId,
    occurredAt: new Date().toISOString(),
    visibility: input.visibility ?? 'public',
    actorUserId: input.actorUserId ?? null,
    payload: input.payload,
  };

  publishToChannel(ORBAT_CHANNEL, ORBAT_ALL_SCOPE, event);
  publishToChannel(ORBAT_CHANNEL, input.orbatId, event);

  return event;
}

export function subscribeOrbatEvents(listener: OrbatEventListener): () => void;
export function subscribeOrbatEvents(orbatId: number, listener: OrbatEventListener): () => void;
export function subscribeOrbatEvents(
  orbatIdOrListener: number | OrbatEventListener,
  listenerArg?: OrbatEventListener
): () => void {
  if (typeof orbatIdOrListener === 'function') {
    return subscribeToChannel(ORBAT_CHANNEL, ORBAT_ALL_SCOPE, orbatIdOrListener);
  }

  if (!listenerArg) {
    throw new Error('Listener is required when subscribing with an orbatId.');
  }

  return subscribeToChannel(ORBAT_CHANNEL, orbatIdOrListener, listenerArg);
}

export function toPublicOrbatEvent(event: OrbatEvent) {
  if (event.visibility !== 'public') {
    return null;
  }

  return {
    id: event.id,
    type: event.type,
    orbatId: event.orbatId,
    occurredAt: event.occurredAt,
    payload: event.payload ?? null,
  };
}
