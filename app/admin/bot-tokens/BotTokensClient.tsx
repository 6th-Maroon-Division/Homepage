'use client';

import React, { useState } from 'react';
import { useToast } from '@/app/components/ui/ToastContainer';
import LoadingSpinner from '@/app/components/ui/LoadingSpinner';

interface BotToken {
  id: number;
  name: string;
  isActive: boolean;
  createdAt: string;
  lastUsedAt: string | null;
  createdBy: {
    id: number;
    username: string | null;
  } | null;
}

interface BotTokenWithValue extends BotToken {
  token: string;
}

export default function BotTokensClient({
  initialTokens = [],
  currentUserId,
}: {
  initialTokens?: BotToken[];
  currentUserId: number;
}) {
  const { showToast } = useToast();
  const [tokens, setTokens] = useState<BotToken[]>(initialTokens);
  const [isLoading, setIsLoading] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [newTokenName, setNewTokenName] = useState('');
  const [newTokenValue, setNewTokenValue] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingName, setEditingName] = useState('');
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const fetchTokens = async () => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/admin/bot-tokens');
      const data = await response.json();
      if (response.ok) {
        setTokens(data.tokens || []);
      } else {
        showToast(data.error || 'Failed to fetch tokens', 'error');
      }
    } catch {
      showToast('Failed to fetch tokens', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateToken = async () => {
    if (!newTokenName.trim()) {
      showToast('Please enter a token name', 'error');
      return;
    }

    setIsCreating(true);
    try {
      const response = await fetch('/api/admin/bot-tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newTokenName.trim() }),
      });

      const data = await response.json();
      if (response.ok) {
        showToast('Token created successfully! Copy the token value below.', 'success');
        setNewTokenValue(data.token.token);
        setNewTokenName('');
        // Refresh tokens list (without the token value)
        await fetchTokens();
      } else {
        showToast(data.error || 'Failed to create token', 'error');
      }
    } catch {
      showToast('Failed to create token', 'error');
    } finally {
      setIsCreating(false);
    }
  };

  const handleStartEdit = (token: BotToken) => {
    setEditingId(token.id);
    setEditingName(token.name);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditingName('');
  };

  const handleSaveEdit = async () => {
    if (!editingName.trim()) {
      showToast('Please enter a valid name', 'error');
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch(`/api/admin/bot-tokens/${editingId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editingName.trim() }),
      });

      const data = await response.json();
      if (response.ok) {
        showToast('Token updated successfully', 'success');
        setEditingId(null);
        setEditingName('');
        await fetchTokens();
      } else {
        showToast(data.error || 'Failed to update token', 'error');
      }
    } catch {
      showToast('Failed to update token', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleToggleActive = async (tokenId: number, currentStatus: boolean) => {
    setIsLoading(true);
    try {
      const response = await fetch(`/api/admin/bot-tokens/${tokenId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !currentStatus }),
      });

      const data = await response.json();
      if (response.ok) {
        showToast(`Token ${!currentStatus ? 'activated' : 'deactivated'}`, 'success');
        await fetchTokens();
      } else {
        showToast(data.error || 'Failed to toggle token status', 'error');
      }
    } catch {
      showToast('Failed to toggle token status', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleStartDelete = (tokenId: number) => {
    setDeletingId(tokenId);
  };

  const handleCancelDelete = () => {
    setDeletingId(null);
  };

  const handleConfirmDelete = async () => {
    if (!deletingId) return;

    setIsLoading(true);
    try {
      const response = await fetch(`/api/admin/bot-tokens/${deletingId}`, {
        method: 'DELETE',
      });

      const data = await response.json();
      if (response.ok) {
        showToast('Token deleted successfully', 'success');
        setDeletingId(null);
        await fetchTokens();
      } else {
        showToast(data.error || 'Failed to delete token', 'error');
      }
    } catch {
      showToast('Failed to delete token', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopyToken = (tokenValue: string) => {
    navigator.clipboard.writeText(tokenValue);
    showToast('Token copied to clipboard!', 'success');
  };

  return (
    <div className="space-y-6">
      <div 
        style={{ 
          backgroundColor: 'var(--secondary)',
          borderRadius: '8px',
          border: '1px solid var(--border)'
        }} 
        className="p-6"
      >
        <h2 style={{ color: 'var(--foreground)' }} className="text-xl font-semibold mb-4">
          Create New Bot Token
        </h2>
        <div className="flex gap-3">
          <input
            type="text"
            value={newTokenName}
            onChange={(e) => setNewTokenName(e.target.value)}
            placeholder="Token name (e.g., Main Bot, Backup Bot)"
            style={{
              backgroundColor: 'var(--primary)',
              color: 'var(--foreground)',
              borderColor: 'var(--border)',
            }}
            className="flex-1 border rounded px-4 py-2 text-sm"
            disabled={isCreating}
          />
          <button
            onClick={handleCreateToken}
            disabled={isCreating || !newTokenName.trim()}
            style={{
              backgroundColor: isCreating ? 'var(--muted-foreground)' : '#10b981',
              color: 'white',
            }}
            className="px-4 py-2 rounded text-sm font-semibold disabled:opacity-50"
          >
            {isCreating ? <LoadingSpinner size="sm" /> : 'Create Token'}
          </button>
        </div>
        {newTokenValue && (
          <div 
            className="mt-4 p-3 rounded" 
            style={{ 
              backgroundColor: 'var(--primary)',
              border: '1px solid #10b981'
            }}
          >
            <p style={{ color: 'var(--foreground)' }} className="text-sm mb-2">
              <strong>New Token Created!</strong> Copy this value immediately - it will not be shown again:
            </p>
            <div className="flex gap-2 items-center">
              <code 
                style={{ 
                  color: '#10b981',
                  fontFamily: 'monospace'
                }} 
                className="text-sm"
              >
                {newTokenValue}
              </code>
              <button
                onClick={() => handleCopyToken(newTokenValue)}
                style={{ color: '#10b981' }}
                className="text-xs font-semibold hover:underline"
              >
                Copy
              </button>
            </div>
            <button
              onClick={() => setNewTokenValue(null)}
              style={{ color: 'var(--muted-foreground)' }}
              className="text-xs mt-2 font-semibold hover:underline"
            >
              Dismiss
            </button>
          </div>
        )}
      </div>

      <div 
        style={{ 
          backgroundColor: 'var(--secondary)',
          borderRadius: '8px',
          border: '1px solid var(--border)'
        }} 
        className="p-6"
      >
        <div className="flex justify-between items-center mb-4">
          <h2 style={{ color: 'var(--foreground)' }} className="text-xl font-semibold">
            Existing Tokens ({tokens.length})
          </h2>
          <button
            onClick={fetchTokens}
            disabled={isLoading}
            style={{
              backgroundColor: 'var(--primary)',
              color: 'var(--foreground)',
              borderColor: 'var(--border)',
            }}
            className="px-3 py-1 rounded text-sm border"
          >
            {isLoading ? <LoadingSpinner size="sm" /> : 'Refresh'}
          </button>
        </div>

        {tokens.length === 0 ? (
          <p style={{ color: 'var(--muted-foreground)' }} className="text-sm text-center py-4">
            No bot tokens found. Create one above to get started.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ color: 'var(--muted-foreground)' }} className="border-b border-border">
                  <th className="text-left p-2">Name</th>
                  <th className="text-left p-2">Status</th>
                  <th className="text-left p-2">Created</th>
                  <th className="text-left p-2">Last Used</th>
                  <th className="text-left p-2">Created By</th>
                  <th className="text-right p-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {tokens.map((token) => (
                  <tr 
                    key={token.id} 
                    style={{ color: 'var(--foreground)' }} 
                    className="border-b border-border"
                  >
                    <td className="p-2">
                      {editingId === token.id ? (
                        <input
                          type="text"
                          value={editingName}
                          onChange={(e) => setEditingName(e.target.value)}
                          style={{
                            backgroundColor: 'var(--primary)',
                            color: 'var(--foreground)',
                            borderColor: 'var(--border)',
                          }}
                          className="w-full border rounded px-2 py-1 text-sm"
                          autoFocus
                        />
                      ) : (
                        <span>{token.name}</span>
                      )}
                    </td>
                    <td className="p-2">
                      <span 
                        className={`px-2 py-1 rounded text-xs font-semibold ${
                          token.isActive 
                            ? 'bg-green-600 text-white' 
                            : 'bg-gray-600 text-white'
                        }`}
                      >
                        {token.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="p-2">
                      {new Date(token.createdAt).toLocaleDateString('en-GB', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </td>
                    <td className="p-2">
                      {token.lastUsedAt 
                        ? new Date(token.lastUsedAt).toLocaleDateString('en-GB', {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric',
                          })
                        : 'Never'}
                    </td>
                    <td className="p-2">
                      {token.createdBy?.username || 'Unknown'}
                    </td>
                    <td className="p-2 text-right">
                      <div className="flex gap-2 justify-end">
                        {editingId === token.id ? (
                          <>
                            <button
                              onClick={handleSaveEdit}
                              style={{ backgroundColor: '#10b981', color: 'white' }}
                              className="px-2 py-1 rounded text-xs"
                            >
                              Save
                            </button>
                            <button
                              onClick={handleCancelEdit}
                              style={{ color: 'var(--muted-foreground)' }}
                              className="px-2 py-1 rounded text-xs"
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={() => handleToggleActive(token.id, token.isActive)}
                              style={{
                                backgroundColor: 'var(--primary)',
                                color: 'var(--foreground)',
                                borderColor: 'var(--border)',
                              }}
                              className="px-2 py-1 rounded text-xs border"
                              title={token.isActive ? 'Deactivate' : 'Activate'}
                            >
                              {token.isActive ? 'Disable' : 'Enable'}
                            </button>
                            <button
                              onClick={() => handleStartEdit(token)}
                              style={{
                                backgroundColor: 'var(--primary)',
                                color: 'var(--foreground)',
                                borderColor: 'var(--border)',
                              }}
                              className="px-2 py-1 rounded text-xs border"
                            >
                              Rename
                            </button>
                            <button
                              onClick={() => handleStartDelete(token.id)}
                              style={{
                                backgroundColor: '#ef4444',
                                color: 'white',
                              }}
                              className="px-2 py-1 rounded text-xs"
                            >
                              Delete
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Delete Confirmation Modal */}
      {deletingId !== null && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 50,
          }}
          onClick={handleCancelDelete}
        >
          <div
            style={{
              backgroundColor: 'var(--secondary)',
              border: '1px solid var(--border)',
              borderRadius: '8px',
              padding: '24px',
              maxWidth: '400px',
              width: '90%',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ color: 'var(--foreground)' }} className="text-lg font-bold mb-4">
              Confirm Delete
            </h3>
            <p style={{ color: 'var(--muted-foreground)' }} className="mb-6">
              Are you sure you want to delete this bot token? This action cannot be undone.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={handleCancelDelete}
                style={{
                  backgroundColor: 'var(--muted-foreground)',
                  color: 'var(--foreground)',
                }}
                className="px-4 py-2 rounded font-semibold"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmDelete}
                disabled={isLoading}
                style={{
                  backgroundColor: isLoading ? 'var(--muted-foreground)' : '#ef4444',
                  color: 'white',
                }}
                className="px-4 py-2 rounded font-semibold disabled:opacity-50"
              >
                {isLoading ? <LoadingSpinner size="sm" /> : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
