'use client';

import { useState } from 'react';
import Link from 'next/link';

type OrbatWithAttendance = {
  id: number;
  name: string;
  eventDate: Date | null;
  attendances: Array<{
    status: 'present' | 'absent' | 'late' | 'gone_early' | 'partial' | 'no_show';
  }>;
  _count: {
    attendances: number;
  };
};

type AttendanceOverviewClientProps = {
  orbats: OrbatWithAttendance[];
};

export default function AttendanceOverviewClient({ orbats: initialOrbats }: AttendanceOverviewClientProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'upcoming' | 'past'>('all');

  const now = new Date();

  // Categorize orbats
  const upcomingOrbats = initialOrbats.filter(o => {
    if (!o.eventDate) return true;
    return new Date(o.eventDate) >= now;
  });

  const pastOrbats = initialOrbats.filter(o => {
    if (!o.eventDate) return false;
    return new Date(o.eventDate) < now;
  });

  // Filter orbats
  const filteredOrbats = initialOrbats.filter(orbat => {
    // Apply time filter
    if (filter === 'upcoming') {
      if (orbat.eventDate && new Date(orbat.eventDate) < now) return false;
    } else if (filter === 'past') {
      if (!orbat.eventDate || new Date(orbat.eventDate) >= now) return false;
    }

    // Apply search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      return orbat.name.toLowerCase().includes(query);
    }

    return true;
  });

  return (
    <div className="border rounded-lg overflow-hidden" style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)' }}>
      <div className="px-6 py-4 flex justify-between items-center" style={{ borderBottomWidth: '1px', borderColor: 'var(--border)' }}>
        <div>
          <h2 className="text-xl font-semibold" style={{ color: 'var(--foreground)' }}>Operations List</h2>
          <p className="text-sm mt-1" style={{ color: 'var(--muted-foreground)' }}>
            {filter === 'all' ? 'All Operations' : filter === 'upcoming' ? 'Upcoming Operations' : 'Past Operations'}
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="px-6 py-4 flex flex-col sm:flex-row gap-4" style={{ borderBottomWidth: '1px', borderColor: 'var(--border)' }}>
        <div className="flex gap-2">
          <button
            onClick={() => setFilter('all')}
            className="px-4 py-2 rounded-md font-medium transition-colors"
            style={{
              backgroundColor: filter === 'all' ? 'var(--primary)' : 'var(--muted)',
              color: filter === 'all' ? 'var(--primary-foreground)' : 'var(--foreground)'
            }}
          >
            All ({initialOrbats.length})
          </button>
          <button
            onClick={() => setFilter('upcoming')}
            className="px-4 py-2 rounded-md font-medium transition-colors"
            style={{
              backgroundColor: filter === 'upcoming' ? 'var(--primary)' : 'var(--muted)',
              color: filter === 'upcoming' ? 'var(--primary-foreground)' : 'var(--foreground)'
            }}
          >
            Upcoming ({upcomingOrbats.length})
          </button>
          <button
            onClick={() => setFilter('past')}
            className="px-4 py-2 rounded-md font-medium transition-colors"
            style={{
              backgroundColor: filter === 'past' ? 'var(--primary)' : 'var(--muted)',
              color: filter === 'past' ? 'var(--primary-foreground)' : 'var(--foreground)'
            }}
          >
            Past ({pastOrbats.length})
          </button>
        </div>

        <input
          type="text"
          placeholder="Search operations..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="flex-1 px-4 py-2 border rounded-md focus:outline-none focus:ring-2"
          style={{ 
            backgroundColor: 'var(--background)', 
            borderColor: 'var(--border)', 
            color: 'var(--foreground)'
          }}
        />
      </div>

      {filteredOrbats.length === 0 ? (
        <div className="px-6 py-12 text-center" style={{ color: 'var(--muted-foreground)' }}>
          <p>No operations found</p>
        </div>
      ) : (
        <div className="px-6 py-4 space-y-3">
          {filteredOrbats.map((orbat) => {
            const attendanceStats = {
              total: orbat._count.attendances,
              present: orbat.attendances.filter((a) => a.status === 'present').length,
              late: orbat.attendances.filter((a) => a.status === 'late').length,
              goneEarly: orbat.attendances.filter((a) => a.status === 'gone_early').length,
              partial: orbat.attendances.filter((a) => a.status === 'partial').length,
              absent: orbat.attendances.filter((a) => a.status === 'absent').length,
              noShow: orbat.attendances.filter((a) => a.status === 'no_show').length,
            };

            return (
              <Link
                key={orbat.id}
                href={`/admin/attendance/${orbat.id}`}
                className="block border rounded-lg p-4 transition-colors hover:opacity-80"
                style={{
                  backgroundColor: 'var(--background)',
                  borderColor: 'var(--border)',
                }}
              >
                <div className="flex justify-between items-start">
                  <div>
                    <h3
                      className="text-lg font-semibold mb-1"
                      style={{ color: 'var(--foreground)' }}
                    >
                      {orbat.name}
                    </h3>
                    <p
                      className="text-sm mb-2"
                      style={{ color: 'var(--muted-foreground)' }}
                    >
                      {orbat.eventDate
                        ? new Date(orbat.eventDate).toLocaleDateString()
                        : 'No date set'}
                    </p>
                    <div className="flex gap-4 text-sm">
                      <span style={{ color: 'var(--foreground)' }}>
                        Total: {attendanceStats.total}
                      </span>
                      {attendanceStats.present > 0 && (
                        <span className="text-green-600">
                          Present: {attendanceStats.present}
                        </span>
                      )}
                      {attendanceStats.late > 0 && (
                        <span className="text-yellow-600">
                          Late: {attendanceStats.late}
                        </span>
                      )}
                      {attendanceStats.partial > 0 && (
                        <span className="text-orange-600">
                          Partial: {attendanceStats.partial}
                        </span>
                      )}
                      {attendanceStats.noShow > 0 && (
                        <span className="text-red-600">
                          No Show: {attendanceStats.noShow}
                        </span>
                      )}
                    </div>
                  </div>
                  <div
                    className="text-sm px-3 py-1 rounded"
                    style={{
                      backgroundColor: 'var(--accent)',
                      color: 'var(--accent-foreground)',
                    }}
                  >
                    View Details →
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
