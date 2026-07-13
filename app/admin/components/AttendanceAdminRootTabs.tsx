'use client';

import React, { useMemo, useState } from 'react';
import AttendanceOverviewClient from './AttendanceOverviewClient';
import { LegacyDataMappingClient } from './LegacyDataMappingClient';

type OrbatSummary = {
  id: number;
  name: string;
  startsAtUtc?: Date | null;
  eventDate: Date | null;
  attendances: Array<{ status: 'present' | 'absent' | 'late' | 'gone_early' | 'partial' | 'no_show' }>;
  _count: { attendances: number };
};

export function AttendanceAdminRootTabs({
  orbats,
}: {
  orbats: OrbatSummary[];
}) {
  const [activeTab, setActiveTab] = useState<'overview' | 'legacy'>('overview');

  const sortedOrbats = useMemo(
    () =>
      [...orbats].sort((a, b) => {
        const aDate = (a.startsAtUtc ?? a.eventDate) ? new Date((a.startsAtUtc ?? a.eventDate)!).getTime() : 0;
        const bDate = (b.startsAtUtc ?? b.eventDate) ? new Date((b.startsAtUtc ?? b.eventDate)!).getTime() : 0;
        return bDate - aDate;
      }),
    [orbats]
  );

  const normalizedOrbats = useMemo(
    () =>
      sortedOrbats.map((o) => ({
        ...o,
        startsAtUtc: o.startsAtUtc ? new Date(o.startsAtUtc) : null,
        eventDate: o.eventDate ? new Date(o.eventDate) : null,
      })),
    [sortedOrbats]
  );

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <button
          onClick={() => setActiveTab('overview')}
          className="px-4 py-2 rounded text-sm font-semibold"
          style={{
            backgroundColor:
              activeTab === 'overview' ? 'var(--primary)' : 'var(--secondary)',
            color: 'var(--foreground)',
            border: '1px solid var(--border)',
          }}
        >
          Overview
        </button>
        <button
          onClick={() => setActiveTab('legacy')}
          className="px-4 py-2 rounded text-sm font-semibold"
          style={{
            backgroundColor:
              activeTab === 'legacy' ? 'var(--primary)' : 'var(--secondary)',
            color: 'var(--foreground)',
            border: '1px solid var(--border)',
          }}
        >
          Legacy Import
        </button>
      </div>

      {activeTab === 'overview' ? (
        <AttendanceOverviewClient orbats={normalizedOrbats} />
      ) : (
        <LegacyDataMappingClient />
      )}
    </div>
  );
}
