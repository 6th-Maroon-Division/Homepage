import { isDateOnly } from './api/utc';

/** Untimed operations use calendar dates in UTC, regardless of the viewer's timezone. */
export function utcOperationDateInput(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : '';
}

export function utcOperationDate(value: string): Date | null {
  return isDateOnly(value) ? new Date(`${value}T00:00:00.000Z`) : null;
}
