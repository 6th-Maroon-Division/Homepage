'use client';

import { useState } from 'react';
import Link from 'next/link';
import DeleteOrbatButton from '../components/DeleteOrbatButton';

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
    <div className="space-y-4">
      {/* Header with Create Button */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-xl font-semibold">Operations List</h2>
        </div>
        <Link
          href="/admin/orbats/new"
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md transition-colors font-medium"
        >
          Create New OrbAT
        </Link>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="flex gap-2">
          <button
            onClick={() => setFilter('all')}
            className={`px-4 py-2 rounded-md font-medium transition-colors ${
              filter === 'all'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            All ({orbats.length})
          </button>
          <button
            onClick={() => setFilter('upcoming')}
            className={`px-4 py-2 rounded-md font-medium transition-colors ${
              filter === 'upcoming'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            Upcoming ({upcomingOrbats.length})
          </button>
          <button
            onClick={() => setFilter('past')}
            className={`px-4 py-2 rounded-md font-medium transition-colors ${
              filter === 'past'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            Past ({pastOrbats.length})
          </button>
        </div>

        <input
          type="text"
          placeholder="Search operations..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="flex-1 px-4 py-2 bg-gray-900/50 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* OrbATs Table */}
      <div className="bg-gray-800/50 border border-gray-700 rounded-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-700">
          <h2 className="text-xl font-semibold">
            {filter === 'all' ? 'All OrbATs' : filter === 'upcoming' ? 'Upcoming Operations' : 'Past Operations'}
          </h2>
        </div>

        {filteredOrbats.length === 0 ? (
          <div className="px-6 py-12 text-center text-gray-400">
            <p>No operations found</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-700/50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                    Name
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                    Event Date
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                    Created By
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                    Details
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700">
                {filteredOrbats.map((orbat) => {
                  const isPast = orbat.eventDate && new Date(orbat.eventDate) < now;
                  return (
                    <tr key={orbat.id} className="hover:bg-gray-700/30">
                      <td className="px-6 py-4">
                        <Link
                          href={`/admin/orbats/${orbat.id}`}
                          className="text-blue-400 hover:text-blue-300 font-medium"
                        >
                          {orbat.name}
                        </Link>
                        {orbat.description && (
                          <div className="text-xs text-gray-400 mt-1 max-w-xs truncate">
                            {orbat.description}
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">
                        {orbat.eventDate ? (
                          <div>
                            <div>{new Date(orbat.eventDate).toLocaleDateString('en-GB')}</div>
                            <div className="text-xs text-gray-500">
                              {new Date(orbat.eventDate).toLocaleTimeString([], {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </div>
                          </div>
                        ) : (
                          <span className="text-gray-500">Not set</span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">
                        {orbat.createdBy.username}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">
                        <div className="text-xs space-y-1">
                          <div>{orbat.slotCount} slots</div>
                          <div>{orbat.totalSubslots} positions</div>
                          <div className="text-blue-400">{orbat.totalSignups} signups</div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {isPast ? (
                          <span className="px-2 py-1 bg-gray-700 text-gray-400 rounded text-xs">
                            Completed
                          </span>
                        ) : (
                          <span className="px-2 py-1 bg-green-600 text-white rounded text-xs font-medium">
                            Active
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm space-x-2">
                        <Link
                          href={`/admin/orbats/${orbat.id}/edit`}
                          className="text-blue-400 hover:text-blue-300 font-medium"
                        >
                          Edit
                        </Link>
                        <span className="text-gray-600">|</span>
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
