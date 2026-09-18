'use client';

import { useSyncExternalStore } from 'react';

const subscribe = () => () => {};
const browserSnapshot = () => true;
const serverSnapshot = () => false;

/** Calendar dates retain their UTC day; instants use the viewer's timezone after hydration. */
export default function LocalDateTime({ value, kind, dateOnly = false }: { value: string; kind: 'date' | 'time'; dateOnly?: boolean }) {
  const inBrowser = useSyncExternalStore(subscribe, browserSnapshot, serverSnapshot);
  const calendarDate = value.slice(0, 10);
  const date = new Date(dateOnly ? `${calendarDate}T00:00:00.000Z` : value);
  const text = inBrowser
    ? kind === 'time'
      ? date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
      : date.toLocaleDateString(undefined, { dateStyle: 'medium', ...(dateOnly ? { timeZone: 'UTC' } : {}) })
    : kind === 'time' ? `${value.slice(11, 16)} UTC` : calendarDate;
  return <time dateTime={dateOnly ? calendarDate : value}>{text}</time>;
}
