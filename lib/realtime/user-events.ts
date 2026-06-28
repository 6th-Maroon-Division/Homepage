import { nextEventId, publishToChannel, subscribeToChannel } from '@/lib/realtime/event-hub';

export type UserProfileEvent = {
  id: string;
  type: 'user.profile.updated';
  userId: number;
  occurredAt: string;
  payload?: Record<string, unknown>;
};

type UserProfileEventListener = (event: UserProfileEvent) => void;

const USER_PROFILE_CHANNEL = 'user-profile';
const ADMIN_USERS_SCOPE = 'admin-users';

export function publishUserProfileEvent(userId: number, payload?: Record<string, unknown>): UserProfileEvent {
  const event: UserProfileEvent = {
    id: nextEventId(USER_PROFILE_CHANNEL),
    type: 'user.profile.updated',
    userId,
    occurredAt: new Date().toISOString(),
    payload,
  };

  publishToChannel(USER_PROFILE_CHANNEL, userId, event);
  publishToChannel(USER_PROFILE_CHANNEL, ADMIN_USERS_SCOPE, event);
  return event;
}

export function subscribeUserProfileEvents(userId: number, listener: UserProfileEventListener) {
  return subscribeToChannel(USER_PROFILE_CHANNEL, userId, listener);
}

export function subscribeAdminUserProfileEvents(listener: UserProfileEventListener) {
  return subscribeToChannel(USER_PROFILE_CHANNEL, ADMIN_USERS_SCOPE, listener);
}
