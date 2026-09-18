'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useToast } from '@/app/components/ui/ToastContainer';
import LoadingSpinner from '@/app/components/ui/LoadingSpinner';
import { apiList, apiRequest } from '@/lib/api/client';

type Rank = {
  id: number;
  name: string;
  abbreviation: string;
};

type Proposal = {
  id: number;
  userId: number;
  currentRankId: number;
  nextRankId: number;
  attendanceTotalAtProposal: number;
  attendanceDeltaSinceLastRank: number;
  status: string;
  createdAt: string;
  user: {
    id: number;
    username: string | null;
    discordId: string | null;
  };
  currentRank: Rank | null;
  nextRank: Rank | null;
};

export default function PendingPromotionsClient() {
  const { showSuccess, showError } = useToast();
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isStreamConnected, setIsStreamConnected] = useState(false);
  const [isActing, setIsActing] = useState(false);
  const [isRunningAutoRankup, setIsRunningAutoRankup] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const proposalRequest = useRef<AbortController | null>(null);

  const fetchProposals = useCallback(async () => {
    proposalRequest.current?.abort();
    const controller = new AbortController();
    proposalRequest.current = controller;
    setIsLoading(true);
    try {
      const data = await apiList<Proposal>('/api/ranks/promotions/pending', { signal: controller.signal });
      if (controller.signal.aborted) return;
      setProposals(data);
      setSelected(previous => new Set([...previous].filter(id => data.some(proposal => proposal.id === id))));
    } catch (error) {
      if (controller.signal.aborted) return;
      setProposals([]);
      setSelected(new Set());
      showError(error instanceof Error ? error.message : 'Failed to load pending promotions');
    } finally {
      if (!controller.signal.aborted) setIsLoading(false);
    }
  }, [showError]);

  useEffect(() => {
    void fetchProposals();
    return () => proposalRequest.current?.abort();
  }, [fetchProposals]);

  useEffect(() => {
    const source = new EventSource('/api/ranks/promotions/events');

    source.onopen = () => {
      setIsStreamConnected(true);
      void fetchProposals();
    };

    source.onmessage = () => {
      setIsStreamConnected(true);
      void fetchProposals();
    };

    source.onerror = () => {
      setIsStreamConnected(false);
    };

    return () => {
      source.close();
      setIsStreamConnected(false);
    };
  }, [fetchProposals]);

  useEffect(() => {
    if (isStreamConnected) {
      return;
    }

    const interval = setInterval(() => {
      void fetchProposals();
    }, 30000);

    return () => clearInterval(interval);
  }, [isStreamConnected, fetchProposals]);

  const selectedCount = selected.size;

  const toggleSelectAll = () => {
    if (selected.size === proposals.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(proposals.map((p) => p.id)));
    }
  };

  const toggleSelect = (id: number) => {
    const next = new Set(selected);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelected(next);
  };

  const approveProposal = async (proposalId: number) => {
    await apiRequest<null>(`/api/ranks/promotions/${proposalId}/approve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
  };

  const declineProposal = async (proposalId: number, declineReason: string | null) => {
    await apiRequest<null>(`/api/ranks/promotions/${proposalId}/decline`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ declineReason }) });
  };

  const handleBulkApprove = async () => {
    if (selected.size === 0) return;
    setIsActing(true);
    try {
      await Promise.all(Array.from(selected).map((id) => approveProposal(id)));
      showSuccess('Promotions approved');
      setSelected(new Set());
      await fetchProposals();
    } catch (error) {
      console.error(error);
      showError('Failed to approve promotions');
    } finally {
      setIsActing(false);
    }
  };

  const handleApprove = async (proposalId: number) => {
    setIsActing(true);
    try {
      await approveProposal(proposalId);
      showSuccess('Promotion approved');
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(proposalId);
        return next;
      });
      setProposals((prev) => prev.filter((p) => p.id !== proposalId));
    } catch (error) {
      console.error(error);
      showError('Failed to approve promotion');
    } finally {
      setIsActing(false);
    }
  };

  const handleDecline = async (proposalId: number) => {
    const declineReason = window.prompt('Decline reason (optional):');
    setIsActing(true);
    try {
      await declineProposal(proposalId, declineReason || null);
      showSuccess('Promotion declined');
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(proposalId);
        return next;
      });
      setProposals((prev) => prev.filter((p) => p.id !== proposalId));
    } catch (error) {
      console.error(error);
      showError('Failed to decline promotion');
    } finally {
      setIsActing(false);
    }
  };

  const formattedProposals = useMemo(() => {
    return proposals.map((p) => ({
      ...p,
      createdAtLabel: new Date(p.createdAt).toLocaleString('en-GB'),
      currentRankLabel: p.currentRank?.abbreviation || p.currentRank?.name || 'Unranked',
      nextRankLabel: p.nextRank?.abbreviation || p.nextRank?.name || 'Unknown',
    }));
  }, [proposals]);

  const handleAutoRankup = async () => {
    if (!confirm('Run auto rankup process? This will promote all eligible users.')) return;

    setIsRunningAutoRankup(true);
    try {
      const { data } = await apiRequest<{ promotedCount: number; errorsCount: number; ineligibleCount: number }>('/api/ranks/promotions/automatic', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });

      // Build success message
      let message = `${data.promotedCount} promoted`;
      if (data.errorsCount > 0) {
        message += `, ${data.errorsCount} errors`;
      }
      if (data.ineligibleCount > 0) {
        message += `, ${data.ineligibleCount} not eligible`;
      }
      
      showSuccess(`Auto rankup complete: ${message}`);

      await fetchProposals();
    } catch (error) {
      console.error('Error running auto rankup:', error);
      showError('Failed to run auto rankup');
    } finally {
      setIsRunningAutoRankup(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="border rounded-lg overflow-hidden" style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)' }}>
        <div className="px-6 py-4 flex flex-wrap items-center justify-end gap-2" style={{ borderBottomWidth: '1px', borderColor: 'var(--border)' }}>
          <button
            onClick={fetchProposals}
            disabled={isLoading}
            className="px-3 py-2 rounded-md text-sm font-medium transition-colors"
            style={{
              backgroundColor: 'var(--secondary)',
              color: 'var(--foreground)',
              border: '1px solid var(--border)',
            }}
          >
            Refresh
          </button>
          <button
            onClick={handleAutoRankup}
            disabled={isRunningAutoRankup || isLoading}
            className="px-3 py-2 rounded-md text-sm font-medium transition-colors"
            style={{
              backgroundColor: 'var(--accent)',
              color: 'var(--accent-foreground)',
            }}
          >
            {isRunningAutoRankup ? <LoadingSpinner size="sm" /> : 'Auto Rankup'}
          </button>
          {selectedCount > 0 && (
            <button
              onClick={handleBulkApprove}
              disabled={isActing}
              className="px-3 py-2 rounded-md text-sm font-medium transition-colors"
              style={{
                backgroundColor: 'var(--primary)',
                color: 'var(--primary-foreground)',
              }}
            >
              Approve Selected ({selectedCount})
            </button>
          )}
        </div>
        {isLoading ? (
          <div className="px-6 py-10 flex items-center justify-center" style={{ color: 'var(--muted-foreground)' }}>
            <LoadingSpinner />
          </div>
        ) : formattedProposals.length === 0 ? (
          <div className="px-6 py-10 text-center" style={{ color: 'var(--muted-foreground)' }}>
            No pending promotions
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead style={{ backgroundColor: 'var(--muted)' }}>
                <tr>
                  <th className="px-6 py-3 text-left">
                    <input
                      type="checkbox"
                      checked={selected.size === proposals.length && proposals.length > 0}
                      onChange={toggleSelectAll}
                    />
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--muted-foreground)' }}>
                    User
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--muted-foreground)' }}>
                    Current Rank
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--muted-foreground)' }}>
                    Next Rank
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--muted-foreground)' }}>
                    Attendance
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--muted-foreground)' }}>
                    Created
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--muted-foreground)' }}>
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody style={{ backgroundColor: 'var(--secondary)' }}>
                {formattedProposals.map((proposal) => (
                  <tr key={proposal.id} style={{ borderTopWidth: '1px', borderColor: 'var(--border)' }}>
                    <td className="px-6 py-4">
                      <input
                        type="checkbox"
                        checked={selected.has(proposal.id)}
                        onChange={() => toggleSelect(proposal.id)}
                      />
                    </td>
                    <td className="px-6 py-4" style={{ color: 'var(--foreground)' }}>
                      <div className="font-medium">{proposal.user.username || `User #${proposal.userId}`}</div>
                    </td>
                    <td className="px-6 py-4" style={{ color: 'var(--foreground)' }}>
                      {proposal.currentRankLabel}
                    </td>
                    <td className="px-6 py-4" style={{ color: 'var(--foreground)' }}>
                      {proposal.nextRankLabel}
                    </td>
                    <td className="px-6 py-4" style={{ color: 'var(--foreground)' }}>
                      <div className="text-sm">Total: {proposal.attendanceTotalAtProposal}</div>
                      <div className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
                        Delta: {proposal.attendanceDeltaSinceLastRank}
                      </div>
                    </td>
                    <td className="px-6 py-4" style={{ color: 'var(--foreground)' }}>
                      {proposal.createdAtLabel}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleApprove(proposal.id)}
                          disabled={isActing}
                          className="px-3 py-1 rounded-md text-sm font-medium"
                          style={{ backgroundColor: 'var(--primary)', color: 'var(--primary-foreground)' }}
                        >
                          Approve
                        </button>
                        <button
                          onClick={() => handleDecline(proposal.id)}
                          disabled={isActing}
                          className="px-3 py-1 rounded-md text-sm font-medium"
                          style={{ backgroundColor: 'var(--accent)', color: 'var(--accent-foreground)' }}
                        >
                          Decline
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
