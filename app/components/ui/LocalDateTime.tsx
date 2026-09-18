'use client';

import { useSyncExternalStore } from 'react';

const subscribe = () => () => {};
const browserSnapshot = () => true;
const serverSnapshot = () => false;

/** Hydrate stable UTC text before displaying the viewer's locale and timezone. */
export default function LocalDateTime({ value, kind }: { value: string; kind: 'date' | 'time' }) {
  const inBrowser = useSyncExternalStore(subscribe, browserSnapshot, serverSnapshot);
  const date = new Date(value);
  const text = inBrowser
    ? kind === 'date'
      ? date.toLocaleDateString(undefined, { dateStyle: 'medium' })
      : date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : kind === 'date' ? value.slice(0, 10) : `${value.slice(11, 16)} UTC`;
  return <time dateTime={value}>{text}</time>;
}
