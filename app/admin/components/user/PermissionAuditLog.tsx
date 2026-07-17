// app/admin/components/user/PermissionAuditLog.tsx
'use client';

import { useState, useEffect, useCallback } from 'react';
import Image from 'next/image';
import { useToast } from '@/app/components/ui/ToastContainer';
import LoadingSpinner from '@/app/components/ui/LoadingSpinner';

type AuditLog = {
  id: number;
  action: 'GRANT' | 'REVOKE' | 'MODIFY';
  permission: {
    key: string;
    description: string | null;
  };
  oldValue: number | null;
  newValue: number | null;
  reason: string | null;
  actor: {
    id: number;
    username: string | null;
    avatarUrl: string | null;
  };
  createdAt: string;
  metadata: Record<string, unknown> | null;
};

type PermissionAuditLogProps = {
  userId: number;
  username: string | null;
};

export default function PermissionAuditLog({ userId, username }: PermissionAuditLogProps) {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'GRANT' | 'REVOKE' | 'MODIFY'>('all');
  const [totalCount, setTotalCount] = useState(0);
  const { showError } = useToast();

  const fetchAuditLogs = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams({ limit: '50' });
      if (filter !== 'all') {
        params.append('action', filter);
      }

      const response = await fetch(`/api/users/${userId}/permissions/audit?${params}`);
      
      if (!response.ok) {
        throw new Error('Failed to fetch audit logs');
      }

      const data = await response.json();
      setLogs(data.logs);
      setTotalCount(data.pagination.total);
    } catch (error) {
      console.error('Error fetching audit logs:', error);
      showError('Failed to load permission history');
    } finally {
      setIsLoading(false);
    }
  }, [userId, filter, showError]);

  useEffect(() => {
    fetchAuditLogs();
  }, [fetchAuditLogs]);

  const getActionColor = (action: string) => {
    switch (action) {
      case 'GRANT':
        return 'text-green-400';
      case 'REVOKE':
        return 'text-red-400';
      case 'MODIFY':
        return 'text-blue-400';
      default:
        return 'text-gray-400';
    }
  };

  const getActionIcon = (action: string) => {
    switch (action) {
      case 'GRANT':
        return '+';
      case 'REVOKE':
        return '−';
      case 'MODIFY':
        return '⟳';
      default:
        return '•';
    }
  };

  const formatValue = (value: number | null) => {
    if (value === null) return 'None';
    return value.toString();
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-semibold" style={{ color: 'var(--foreground)' }}>
          Permission Change History for {username}
        </h3>
        <span className="text-sm" style={{ color: 'var(--muted-foreground)' }}>
          {totalCount} {totalCount === 1 ? 'change' : 'changes'}
        </span>
      </div>

      {/* Filter Buttons */}
      <div className="flex gap-2">
        {(['all', 'GRANT', 'REVOKE', 'MODIFY'] as const).map((action) => (
          <button
            key={action}
            onClick={() => setFilter(action)}
            className="px-3 py-1 rounded text-sm font-medium transition-colors"
            style={{
              backgroundColor: filter === action ? 'var(--primary)' : 'var(--secondary)',
              color: filter === action ? 'var(--primary-foreground)' : 'var(--foreground)',
            }}
          >
            {action === 'all' ? 'All' : action}
          </button>
        ))}
      </div>

      {/* Audit Log List */}
      {isLoading ? (
        <div className="flex justify-center py-8">
          <LoadingSpinner />
        </div>
      ) : logs.length === 0 ? (
        <div className="text-center py-8" style={{ color: 'var(--muted-foreground)' }}>
          No permission changes recorded
        </div>
      ) : (
        <div className="space-y-2">
          {logs.map((log) => (
            <div
              key={log.id}
              className="p-4 rounded-lg border"
              style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)' }}
            >
              <div className="flex items-start gap-3">
                {/* Action Icon */}
                <div
                  className={`text-2xl font-bold ${getActionColor(log.action)} shrink-0`}
                  title={log.action}
                >
                  {getActionIcon(log.action)}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  {/* Permission Name */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1">
                      <div className="font-medium" style={{ color: 'var(--foreground)' }}>
                        {log.permission.key}
                      </div>
                      {log.permission.description && (
                        <div className="text-xs mt-1" style={{ color: 'var(--muted-foreground)' }}>
                          {log.permission.description}
                        </div>
                      )}
                    </div>
                    
                    {/* Timestamp */}
                    <div className="text-xs whitespace-nowrap" style={{ color: 'var(--muted-foreground)' }}>
                      {new Date(log.createdAt).toLocaleString('en-GB', {
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </div>
                  </div>

                  {/* Value Change */}
                  <div className="flex items-center gap-2 mt-2 text-sm">
                    <span style={{ color: 'var(--muted-foreground)' }}>Value:</span>
                    <span className="font-mono" style={{ color: 'var(--foreground)' }}>
                      {formatValue(log.oldValue)}
                    </span>
                    <span style={{ color: 'var(--muted-foreground)' }}>→</span>
                    <span className="font-mono" style={{ color: 'var(--foreground)' }}>
                      {formatValue(log.newValue)}
                    </span>
                  </div>

                  {/* Actor */}
                  <div className="flex items-center gap-2 mt-2">
                    {log.actor.avatarUrl && (
                      <Image
                        src={log.actor.avatarUrl}
                        alt={log.actor.username || 'Actor'}
                        width={20}
                        height={20}
                        unoptimized={log.actor.avatarUrl.startsWith('/uploads/')}
                        className="rounded-full"
                      />
                    )}
                    <span className="text-sm" style={{ color: 'var(--muted-foreground)' }}>
                      by{' '}
                      <span style={{ color: 'var(--foreground)' }}>
                        {log.actor.username || `User ${log.actor.id}`}
                      </span>
                    </span>
                  </div>

                  {/* Reason (if present) */}
                  {log.reason && (
                    <div className="mt-2 text-sm italic" style={{ color: 'var(--muted-foreground)' }}>
                      Reason: {log.reason}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
