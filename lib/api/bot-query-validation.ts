import { parseUtcTimestamp } from './utc';
import { parsePositiveId } from './validation';

type QueryResult<T> = { data: T; error?: never } | { data?: never; error: string };

export function parseOrbatTimeRange(
  params: URLSearchParams,
): QueryResult<{ startAt: Date | null; endBefore: Date | null }> {
  const startAt = params.has('startAt') ? parseUtcTimestamp(params.get('startAt')) : null;
  const endBefore = params.has('endBefore') ? parseUtcTimestamp(params.get('endBefore')) : null;
  if ((params.has('startAt') && !startAt) || (params.has('endBefore') && !endBefore)) {
    return { error: 'startAt and endBefore must be ISO timestamps with an explicit timezone.' };
  }
  if (startAt && endBefore && startAt >= endBefore) {
    return { error: 'startAt must be before endBefore' };
  }
  return { data: { startAt, endBefore } };
}

export function parsePromotionLookback(
  params: URLSearchParams,
  now = new Date(),
): QueryResult<{ days: number; cutoffDate: Date }> {
  const days = params.has('days') ? parsePositiveId(params.get('days')) : 7;
  if (days === null) return { error: 'days must be a positive integer.' };
  const cutoffDate = new Date(now.getTime());
  cutoffDate.setUTCDate(cutoffDate.getUTCDate() - days);
  // Keep filters inside the API's four-digit calendar-year timestamp range.
  if (!Number.isFinite(cutoffDate.getTime()) || cutoffDate.getUTCFullYear() < 1 || cutoffDate.getUTCFullYear() > 9999) {
    return { error: 'days exceeds the supported date range.' };
  }
  return { data: { days, cutoffDate } };
}
