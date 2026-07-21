export const FAILED_TRAINING_RETRY_COOLDOWN_MS = 60 * 60 * 1000;

export function getFailedTrainingRetryAt(
  failedAt: Date | null,
  statusUpdatedAt: Date,
): Date {
  const failureTime = failedAt ?? statusUpdatedAt;
  return new Date(failureTime.getTime() + FAILED_TRAINING_RETRY_COOLDOWN_MS);
}

export function canRetryFailedTraining(
  failedAt: Date | null,
  statusUpdatedAt: Date,
  now = new Date(),
): boolean {
  return getFailedTrainingRetryAt(failedAt, statusUpdatedAt) <= now;
}
