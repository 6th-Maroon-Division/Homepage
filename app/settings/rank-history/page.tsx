'use client';

import { useEffect, useState, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { redirect } from 'next/navigation';
import LoadingSpinner from '@/app/components/ui/LoadingSpinner';

type RankHistoryEntry = {
  id: number;
  previousRankName: string | null;
  newRankName: string;
  attendanceTotalAtChange: number;
  attendanceDeltaSinceLastRank: number;
  triggeredBy: string;
  outcome: string | null;
  declineReason: string | null;
  createdAt: string;
};

type Pagination = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export default function RankHistoryPage() {
  const { data: session, status } = useSession();
  const [history, setHistory] = useState<RankHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [error, setError] = useState('');

  const fetchRankHistory = useCallback(
    async (pageNum: number) => {
      try {
        setLoading(true);
        const response = await fetch(
          `/api/users/${session?.user?.id}/rank-history?page=${pageNum}`
        );

        if (!response.ok) {
          throw new Error('Failed to fetch rank history');
        }

        const data = await response.json();
        setHistory(data.data);
        setPagination(data.pagination);
        setError('');
      } catch (err) {
        console.error('Error fetching rank history:', err);
        setError('Failed to load rank history');
      } finally {
        setLoading(false);
      }
    },
    [session?.user?.id]
  );

  useEffect(() => {
    if (status === 'unauthenticated') {
      redirect('/');
    }

    if (session?.user?.id) {
      fetchRankHistory(page);
    }
  }, [session?.user?.id, page, status, fetchRankHistory]);

  if (status === 'loading' || loading) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <LoadingSpinner size="lg" />
      </main>
    );
  }

  return (
    <main className="min-h-screen">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        <div className="border rounded-lg p-6" style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)' }}>
          <h1 className="text-2xl font-bold mb-4" style={{ color: 'var(--foreground)' }}>
            Rank History
          </h1>

          {error && (
            <div className="mb-4 p-4 rounded-lg border" style={{ backgroundColor: 'var(--destructive)', color: 'var(--destructive-foreground)', borderColor: 'var(--destructive)' }}>
              {error}
            </div>
          )}

          {history.length === 0 ? (
            <p style={{ color: 'var(--muted-foreground)' }}>No rank history yet</p>
          ) : (
            <div className="space-y-4">
              {history.map((entry) => (
                <div
                  key={entry.id}
                  className="border rounded-lg p-4"
                  style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)' }}
                >
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs px-2 py-1 rounded font-semibold" style={{ backgroundColor: 'var(--muted)', color: 'var(--foreground)' }}>
                        {entry.previousRankName || 'Unranked'} → {entry.newRankName}
                      </span>
                      <span
                        className="text-xs px-2 py-1 rounded font-semibold"
                        style={{
                          backgroundColor:
                            entry.outcome === 'approved'
                              ? 'var(--primary)'
                              : entry.outcome === 'declined'
                                ? 'var(--destructive)'
                                : 'var(--muted)',
                          color:
                            entry.outcome === 'approved'
                              ? 'var(--primary-foreground)'
                              : entry.outcome === 'declined'
                                ? 'var(--destructive-foreground)'
                                : 'var(--foreground)',
                        }}
                      >
                        {entry.outcome?.toUpperCase() || 'PENDING'}
                      </span>
                    </div>
                    <span className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
                      {new Date(entry.createdAt).toLocaleDateString('en-US', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>

                  <div className="space-y-1 text-sm" style={{ color: 'var(--muted-foreground)' }}>
                    <p>
                      Attendance: {entry.attendanceDeltaSinceLastRank} ops since last rank (Total: {entry.attendanceTotalAtChange})
                    </p>
                    <p>
                      Triggered by: <span style={{ textTransform: 'capitalize' }}>{entry.triggeredBy}</span>
                    </p>
                    {entry.declineReason && (
                      <p>
                        Decline reason: <em>{entry.declineReason}</em>
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Pagination */}
          {pagination && pagination.totalPages > 1 && (
            <div className="mt-6 flex justify-center gap-2">
              <button
                onClick={() => setPage(Math.max(1, page - 1))}
                disabled={page === 1}
                className="px-3 py-2 rounded-md border disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }}
              >
                Previous
              </button>

              <div style={{ color: 'var(--muted-foreground)' }} className="px-3 py-2 text-sm">
                Page {page} of {pagination.totalPages}
              </div>

              <button
                onClick={() => setPage(Math.min(pagination.totalPages, page + 1))}
                disabled={page === pagination.totalPages}
                className="px-3 py-2 rounded-md border disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }}
              >
                Next
              </button>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
