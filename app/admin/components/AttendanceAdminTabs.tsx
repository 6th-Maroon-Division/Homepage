'use client';

import React, { useState } from 'react';
import AttendanceManagement from '@/app/admin/components/AttendanceManagement';
import { LegacyDataMappingClient } from '@/app/admin/components/LegacyDataMappingClient';

export function AttendanceAdminTabs({ orbatId }: { orbatId: number }) {
  const [activeTab, setActiveTab] = useState<'attendance' | 'legacy'>('attendance');

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <button
          onClick={() => setActiveTab('attendance')}
          className="px-4 py-2 rounded text-sm font-semibold"
          style={{
            backgroundColor:
              activeTab === 'attendance' ? 'var(--primary)' : 'var(--secondary)',
            color: 'var(--foreground)',
            border: '1px solid var(--border)',
          }}
        >
          Attendance
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

      {activeTab === 'attendance' ? (
        <div
          className="border rounded-lg p-6"
          style={{
            backgroundColor: 'var(--secondary)',
            borderColor: 'var(--border)',
          }}
        >
          <AttendanceManagement orbatId={orbatId} />
        </div>
      ) : (
        <LegacyDataMappingClient signupsOrbatId={orbatId} />
      )}
    </div>
  );
}
