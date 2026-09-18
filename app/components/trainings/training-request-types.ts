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
  const parsed = typeof value === 'number' ? value : Number.NaN;
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
    username: asNullableString(record.username),
    avatarUrl: asNullableString(record.avatarUrl),
  };
}

export function normalizeTrainingMessage(value: unknown): TrainingRequestMessage | null {
  const record = asRecord(value);
  const id = asNumber(record.id);
  const content = asNullableString(record.body);
  if (!id || !content) return null;

  const sender = normalizeUser(record.sender);
  const rawRole = String(record.senderRole ?? '').toLowerCase();
  const senderRole = rawRole === 'system'
    ? 'system'
    : rawRole === 'staff'
      ? 'staff'
      : 'user';

  return {
    id,
    content,
    createdAt: asNullableString(record.createdAt) ?? '',
    senderId: record.senderId === null ? null : asNumber(record.senderId ?? sender?.id) || null,
    senderRole,
    sender,
  };
}

export function normalizeTrainingSession(value: unknown): TrainingRequestSession | null {
  const record = asRecord(value);
  const id = asNumber(record.id);
  if (!id) return null;

  const duration = record.durationMinutes;
  return {
    id,
    startsAt: asNullableString(record.startsAt),
    endsAt: asNullableString(record.endsAt),
    durationMinutes: duration === null || duration === undefined ? null : asNumber(duration),
    status: asNullableString(record.status) ?? 'proposed',
    confirmedAt: asNullableString(record.confirmedAt),
    instructions: asNullableString(record.specialInstructions),
    trainer: normalizeUser(record.trainer),
  };
}

export function normalizeSubscription(value: unknown): TrainingChatSubscription {
  const record = asRecord(value);
  return {
    website: Boolean(record.websiteEnabled),
    discord: Boolean(record.discordEnabled),
  };
}

export function normalizeTrainingRequestDetail(value: unknown): TrainingRequestDetail {
  const outer = asRecord(value);
  const record = outer;
  const training = asRecord(record.training);
  const rawMessages = Array.isArray(record.messages)
    ? record.messages
    : Array.isArray(outer.messages)
      ? outer.messages
      : [];

  const assignedTrainer = normalizeUser(record.assignedTrainer);
  const normalizedSession = normalizeTrainingSession(
    record.session,
  );

  return {
    id: asNumber(record.id),
    userId: asNumber(record.userId ?? asRecord(record.user).id),
    trainingId: asNumber(record.trainingId ?? training.id),
    status: asNullableString(record.status) ?? 'pending',
    requestMessage: asNullableString(record.requestMessage),
    adminResponse: asNullableString(record.adminResponse),
    requestedAt: asNullableString(record.requestedAt) ?? '',
    updatedAt: asNullableString(record.updatedAt) ?? '',
    training: {
      id: asNumber(training.id ?? record.trainingId),
      name: asNullableString(training.name) ?? 'Training',
      description: asNullableString(training.description),
      duration: training.duration === null || training.duration === undefined ? null : asNumber(training.duration),
      requiresTrainingSession: training.requiresTrainingSession !== false,
      requiresOrbatQualification: Boolean(training.requiresOrbatQualification),
      qualificationNotes: asNullableString(training.orbatQualificationNotes),
    },
    user: normalizeUser(record.user),
    messages: rawMessages
      .map(normalizeTrainingMessage)
      .filter((message): message is TrainingRequestMessage => message !== null)
      .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime()),
    session: normalizedSession
      ? { ...normalizedSession, trainer: normalizedSession.trainer ?? assignedTrainer }
      : null,
    subscription: normalizeSubscription(record.subscription),
  };
}
