'use client';

import { useState } from 'react';
import Link from 'next/link';
import DeleteOrbatButton from '../../../components/orbat/DeleteOrbatButton';

type Orbat = {
  id: number;
  name: string;
  description: string | null;
  eventDate: string | null;
  createdAt: string;
  createdBy: {
    id: number;
    username: string;
  };
  slotCount: number;
  totalSignups: number;
  totalSubslots: number;
};

type OrbatManagementClientProps = {
  orbats: Orbat[];
};

export default function OrbatManagementClient({ orbats: initialOrbats }: OrbatManagementClientProps) {
  const [orbats] = useState<Orbat[]>(initialOrbats);
  const [filter, setFilter] = useState<'all' | 'upcoming' | 'past'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const now = new Date();

  // Categorize orbats
  const upcomingOrbats = orbats.filter(o => {
    if (!o.eventDate) return true; // No date = treat as upcoming
    return new Date(o.eventDate) >= now;
  });

  const pastOrbats = orbats.filter(o => {
    if (!o.eventDate) return false;
    return new Date(o.eventDate) < now;
  });

  // Filter orbats
  const filteredOrbats = orbats.filter(orbat => {
    // Apply time filter
    if (filter === 'upcoming') {
      if (orbat.eventDate && new Date(orbat.eventDate) < now) return false;
    } else if (filter === 'past') {
      if (!orbat.eventDate || new Date(orbat.eventDate) >= now) return false;
    }

    // Apply search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      return (
        orbat.name.toLowerCase().includes(query) ||
        orbat.description?.toLowerCase().includes(query) ||
        orbat.createdBy.username.toLowerCase().includes(query)
      );
    }

    return true;
  });

  return (
    <div>
      {/* OrbATs Table */}
      <div className="border rounded-lg overflow-hidden" style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)' }}>
        <div className="px-6 py-4 flex justify-between items-center" style={{ borderBottomWidth: '1px', borderColor: 'var(--border)' }}>
          <div>
            <h2 className="text-xl font-semibold" style={{ color: 'var(--foreground)' }}>Operations List</h2>
            <p className="text-sm mt-1" style={{ color: 'var(--muted-foreground)' }}>
              {filter === 'all' ? 'All OrbATs' : filter === 'upcoming' ? 'Upcoming Operations' : 'Past Operations'}
            </p>
          </div>
          <Link
            href="/admin/orbats/new"
            className="px-4 py-2 rounded-md transition-colors font-medium"
            style={{ backgroundColor: 'var(--primary)', color: 'var(--primary-foreground)' }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'var(--button-hover)';
              e.currentTarget.style.color = 'var(--button-hover-foreground)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'var(--primary)';
              e.currentTarget.style.color = 'var(--primary-foreground)';
            }}
          >
            Create New OrbAT
          </Link>
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
              All ({orbats.length})
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
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead style={{ backgroundColor: 'var(--muted)' }}>
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--muted-foreground)' }}>
                    Name
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--muted-foreground)' }}>
                    Event Date
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--muted-foreground)' }}>
                    Created By
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--muted-foreground)' }}>
                    Details
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--muted-foreground)' }}>
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--muted-foreground)' }}>
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody style={{ borderTopWidth: '1px', borderColor: 'var(--border)' }}>
                {filteredOrbats.map((orbat) => {
                  const isPast = orbat.eventDate && new Date(orbat.eventDate) < now;
                  return (
                    <tr key={orbat.id} style={{ borderBottomWidth: '1px', borderColor: 'var(--border)' }}>
                      <td className="px-6 py-4">
                        <Link
                          href={`/admin/orbats/${orbat.id}`}
                          className="font-medium hover:underline"
                          style={{ color: 'var(--primary)' }}
                        >
                          {orbat.name}
                        </Link>
                        {orbat.description && (
                          <div className="text-xs mt-1 max-w-xs truncate" style={{ color: 'var(--muted-foreground)' }}>
                            {orbat.description}
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm" style={{ color: 'var(--foreground)' }}>
                        {orbat.eventDate ? (
                          <div>
                            <div>{new Date(orbat.eventDate).toLocaleDateString('en-GB')}</div>
                            <div className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
                              {new Date(orbat.eventDate).toLocaleTimeString('en-GB', {
                                hour: '2-digit',
                                minute: '2-digit',
                                hour12: false,
                              })}
                            </div>
                          </div>
                        ) : (
                          <span style={{ color: 'var(--muted-foreground)' }}>Not set</span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm" style={{ color: 'var(--foreground)' }}>
                        {orbat.createdBy.username}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm" style={{ color: 'var(--foreground)' }}>
                        <div className="text-xs space-y-1">
                          <div>{orbat.slotCount} slots</div>
                          <div>{orbat.totalSubslots} positions</div>
                          <div style={{ color: 'var(--primary)' }}>{orbat.totalSignups} signups</div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {isPast ? (
                          <span className="px-2 py-1 rounded text-xs" style={{ backgroundColor: 'var(--muted)', color: 'var(--muted-foreground)' }}>
                            Completed
                          </span>
                        ) : (
                          <span className="px-2 py-1 rounded text-xs font-medium" style={{ backgroundColor: 'var(--accent)', color: 'var(--accent-foreground)' }}>
                            Active
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm space-x-2">
                        <Link
                          href={`/admin/orbats/${orbat.id}/edit`}
                          className="font-medium hover:underline"
                          style={{ color: 'var(--primary)' }}
                        >
                          Edit
                        </Link>
                        <span style={{ color: 'var(--border)' }}>|</span>
                        <DeleteOrbatButton orbatId={orbat.id} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
