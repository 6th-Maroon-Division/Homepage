export type TrainingRequestUser = {
  id: number;
  username: string | null;
  avatarUrl?: string | null;
};

export type TrainingRequestMessage = {
  id: number;
  content: string;
  createdAt: string;
  senderId: number | null;
  senderRole: 'user' | 'staff' | 'system';
  sender: TrainingRequestUser | null;
};

export type TrainingRequestSession = {
  id: number;
  startsAt: string | null;
  endsAt: string | null;
  durationMinutes: number | null;
  status: string;
  confirmedAt: string | null;
  instructions: string | null;
  trainer: TrainingRequestUser | null;
};

export type TrainingChatSubscription = {
  website: boolean;
  discord: boolean;
};

export type TrainingRequestDetail = {
  id: number;
  userId: number;
  trainingId: number;
  status: string;
  requestMessage: string | null;
  adminResponse: string | null;
  requestedAt: string;
  updatedAt: string;
  training: {
    id: number;
    name: string;
    description: string | null;
    duration: number | null;
    requiresTrainingSession: boolean;
    requiresOrbatQualification: boolean;
    qualificationNotes: string | null;
  };
  user: TrainingRequestUser | null;
  messages: TrainingRequestMessage[];
  session: TrainingRequestSession | null;
  subscription: TrainingChatSubscription;
};

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === 'object' ? (value as UnknownRecord) : {};
}

function asNumber(value: unknown, fallback = 0): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function asNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function normalizeUser(value: unknown): TrainingRequestUser | null {
  const record = asRecord(value);
  const id = asNumber(record.id);
  if (!id) return null;

  return {
    id,
    username: asNullableString(record.username ?? record.name),
    avatarUrl: asNullableString(record.avatarUrl ?? record.avatar),
  };
}

export function normalizeTrainingMessage(value: unknown): TrainingRequestMessage | null {
  const record = asRecord(value);
  const id = asNumber(record.id);
  const content = asNullableString(record.content ?? record.body ?? record.message);
  if (!id || !content) return null;

  const sender = normalizeUser(record.sender ?? record.user ?? record.author);
  const rawRole = String(record.senderRole ?? record.senderType ?? record.kind ?? record.role ?? '').toLowerCase();
  const senderRole = rawRole === 'system'
    ? 'system'
    : rawRole === 'staff' || rawRole === 'trainer' || rawRole === 'admin'
      ? 'staff'
      : 'user';

  return {
    id,
    content,
    createdAt: asNullableString(record.createdAt ?? record.sentAt) ?? new Date().toISOString(),
    senderId: record.senderId === null ? null : asNumber(record.senderId ?? sender?.id) || null,
    senderRole,
    sender,
  };
}

export function normalizeTrainingSession(value: unknown): TrainingRequestSession | null {
  const record = asRecord(value);
  const id = asNumber(record.id);
  if (!id) return null;

  const duration = record.durationMinutes ?? record.duration;
  return {
    id,
    startsAt: asNullableString(record.startsAt ?? record.startsAtUtc ?? record.scheduledAt ?? record.startTime),
    endsAt: asNullableString(record.endsAt ?? record.endsAtUtc ?? record.endTime),
    durationMinutes: duration === null || duration === undefined ? null : asNumber(duration),
    status: asNullableString(record.status) ?? 'proposed',
    confirmedAt: asNullableString(record.confirmedAt ?? record.scheduleConfirmedAt),
    instructions: asNullableString(record.instructions ?? record.specialInstructions),
    trainer: normalizeUser(record.trainer ?? record.assignedTrainer),
  };
}

export function normalizeSubscription(value: unknown): TrainingChatSubscription {
  const record = asRecord(value);
  return {
    website: Boolean(record.website ?? record.websiteEnabled ?? record.web),
    discord: Boolean(record.discord ?? record.discordEnabled),
  };
}

export function normalizeTrainingRequestDetail(value: unknown): TrainingRequestDetail {
  const outer = asRecord(value);
  const record = asRecord(outer.request ?? outer.trainingRequest ?? value);
  const training = asRecord(record.training);
  const rawMessages = Array.isArray(record.messages)
    ? record.messages
    : Array.isArray(outer.messages)
      ? outer.messages
      : [];

  const sessionAttendee = asRecord(record.sessionAttendee ?? outer.sessionAttendee);
  const assignedTrainer = normalizeUser(record.assignedTrainer ?? outer.assignedTrainer);
  const normalizedSession = normalizeTrainingSession(
    record.session ?? record.trainingSession ?? sessionAttendee.session ?? outer.session,
  );

  return {
    id: asNumber(record.id),
    userId: asNumber(record.userId ?? asRecord(record.user).id),
    trainingId: asNumber(record.trainingId ?? training.id),
    status: asNullableString(record.workflowStatus ?? record.status) ?? 'pending',
    requestMessage: asNullableString(record.requestMessage),
    adminResponse: asNullableString(record.adminResponse),
    requestedAt: asNullableString(record.requestedAt ?? record.createdAt) ?? new Date().toISOString(),
    updatedAt: asNullableString(record.updatedAt) ?? new Date().toISOString(),
    training: {
      id: asNumber(training.id ?? record.trainingId),
      name: asNullableString(training.name ?? record.trainingName) ?? 'Training',
      description: asNullableString(training.description),
      duration: training.duration === null || training.duration === undefined ? null : asNumber(training.duration),
      requiresTrainingSession: training.requiresTrainingSession !== false,
      requiresOrbatQualification: Boolean(training.requiresOrbatQualification),
      qualificationNotes: asNullableString(training.qualificationNotes ?? training.orbatQualificationNotes),
    },
    user: normalizeUser(record.user ?? outer.user),
    messages: rawMessages
      .map(normalizeTrainingMessage)
      .filter((message): message is TrainingRequestMessage => message !== null)
      .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime()),
    session: normalizedSession
      ? { ...normalizedSession, trainer: normalizedSession.trainer ?? assignedTrainer }
      : null,
    subscription: normalizeSubscription(record.subscription ?? outer.subscription),
  };
}
