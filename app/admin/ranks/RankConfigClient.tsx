"use client";

import { useEffect, useState } from 'react';
import { useToast } from '@/app/components/ui/ToastContainer';

type Rank = {
  id: number;
  name: string;
  abbreviation: string;
  orderIndex: number;
  attendanceRequiredSinceLastRank: number | null;
  autoRankupEnabled: boolean;
};

type DragState = {
  draggedIndex: number | null;
  dragOverIndex: number | null;
};

export default function RankConfigClient() {
  const { showToast } = useToast();
  const [ranks, setRanks] = useState<Rank[]>([]);
  const [loading, setLoading] = useState(false);
  const [dragState, setDragState] = useState<DragState>({ draggedIndex: null, dragOverIndex: null });
  const [discordGuildId, setDiscordGuildId] = useState('');
  const [discordRoles, setDiscordRoles] = useState<Record<number, string>>({});

  const [form, setForm] = useState<Partial<Rank>>({
    name: '',
    abbreviation: '',
    orderIndex: 0,
    attendanceRequiredSinceLastRank: null,
    autoRankupEnabled: false,
  });

  const fetchRanks = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/ranks');
      const data = await res.json();
      setRanks(data.ranks || []);
    } catch (e) {
      console.error(e);
      showToast('Failed to load ranks', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRanks();
  }, []);

  const createRank = async () => {
    try {
      const res = await fetch('/api/ranks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error('Failed to create');
      showToast('Rank created', 'success');
      setForm({ name: '', abbreviation: '', orderIndex: 0, attendanceRequiredSinceLastRank: null, autoRankupEnabled: false });
      fetchRanks();
    } catch (e) {
      showToast('Failed to create rank', 'error');
    }
  };

  const updateRank = async (rank: Rank) => {
    try {
      const res = await fetch(`/api/ranks/${rank.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rank),
      });
      if (!res.ok) throw new Error('Failed to update');
      showToast('Rank updated', 'success');
      fetchRanks();
    } catch (e) {
      showToast('Failed to update rank', 'error');
    }
  };

  const deleteRank = async (id: number) => {
    try {
      const res = await fetch(`/api/ranks/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const err = await res.json();
        showToast(err.error || 'Failed to delete', 'error');
        return;
      }
      showToast('Rank deleted', 'success');
      fetchRanks();
    } catch (e) {
      showToast('Failed to delete rank', 'error');
    }
  };

  const saveOrder = async () => {
    try {
      const payload = { ranks: ranks.map((r) => ({ id: r.id, orderIndex: r.orderIndex })) };
      const res = await fetch('/api/ranks/reorder', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('Failed to reorder');
      showToast('Order saved', 'success');
      fetchRanks();
    } catch (e) {
      showToast('Failed to save order', 'error');
    }
  };

  const loadDiscordRoles = async () => {
    if (!/^\d{17,20}$/.test(discordGuildId)) return showToast('Enter a valid Discord guild ID', 'error');
    const response = await fetch(`/api/admin/ranks/discord-roles?guildId=${encodeURIComponent(discordGuildId)}`);
    if (!response.ok) return showToast('Failed to load Discord role mappings', 'error');
    const data = await response.json();
    setDiscordRoles(Object.fromEntries((data.mappings ?? []).map((item: { rankId: number; discordRoleId: string }) => [item.rankId, item.discordRoleId])));
  };

  const saveDiscordRole = async (rankId: number) => {
    const discordRoleId = discordRoles[rankId]?.trim();
    if (!/^\d{17,20}$/.test(discordGuildId) || !/^\d{17,20}$/.test(discordRoleId ?? '')) {
      return showToast('Guild and role IDs must be Discord snowflakes', 'error');
    }
    const response = await fetch(`/api/admin/ranks/${rankId}/discord-role`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ guildId: discordGuildId, discordRoleId }),
    });
    showToast(response.ok ? 'Discord role mapping saved' : 'Failed to save Discord role mapping', response.ok ? 'success' : 'error');
  };

  const deleteDiscordRole = async (rankId: number) => {
    if (!/^\d{17,20}$/.test(discordGuildId)) return showToast('Enter a valid Discord guild ID', 'error');
    const response = await fetch(`/api/admin/ranks/${rankId}/discord-role?guildId=${encodeURIComponent(discordGuildId)}`, { method: 'DELETE' });
    if (response.ok) setDiscordRoles((current) => { const next = { ...current }; delete next[rankId]; return next; });
    showToast(response.ok ? 'Discord role mapping removed' : 'Failed to remove Discord role mapping', response.ok ? 'success' : 'error');
  };

  const handleDragStart = (index: number) => {
    setDragState({ ...dragState, draggedIndex: index });
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (dragState.draggedIndex === null || dragState.draggedIndex === index) return;
    setDragState({ ...dragState, dragOverIndex: index });
  };

  const handleDrop = (index: number) => {
    if (dragState.draggedIndex === null) return;

    const reordered = [...ranks];
    const [dragged] = reordered.splice(dragState.draggedIndex, 1);
    reordered.splice(index, 0, dragged);

    // Update orderIndex for all items
    const updated = reordered.map((r, idx) => ({ ...r, orderIndex: idx }));
    setRanks(updated);
    setDragState({ draggedIndex: null, dragOverIndex: null });
  };

  const handleDragEnd = () => {
    setDragState({ draggedIndex: null, dragOverIndex: null });
  };

  return (
    <div className="rounded-lg border p-6" style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)' }}>
      <h2 className="text-xl font-semibold mb-4" style={{ color: 'var(--foreground)' }}>Manage Ranks</h2>

      {/* Create Rank */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-3 mb-4">
        <input
          className="border rounded-md px-3 py-2"
          style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
          placeholder="Name"
          value={form.name || ''}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
        />
        <input
          className="border rounded-md px-3 py-2"
          style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
          placeholder="Abbreviation"
          value={form.abbreviation || ''}
          onChange={(e) => setForm((f) => ({ ...f, abbreviation: e.target.value }))}
        />
        <input
          type="number"
          className="border rounded-md px-3 py-2"
          style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
          placeholder="Attendance Required (optional)"
          value={form.attendanceRequiredSinceLastRank ?? ''}
          onChange={(e) => {
            const val = e.target.value;
            setForm((f) => ({ ...f, attendanceRequiredSinceLastRank: val === '' ? null : Number(val) }));
          }}
        />
        <div className="flex items-center gap-2">
          <label className="text-sm" style={{ color: 'var(--foreground)' }}>Auto</label>
          <input
            type="checkbox"
            checked={!!form.autoRankupEnabled}
            onChange={(e) => setForm((f) => ({ ...f, autoRankupEnabled: e.target.checked }))}
          />
        </div>
        <div className="flex items-center gap-2">
          <button
            className="ml-auto px-4 py-2 rounded-md"
            style={{ backgroundColor: 'var(--primary)', color: 'var(--primary-foreground)' }}
            onClick={createRank}
          >
            Create
          </button>
        </div>
      </div>

      {/* Ranks List */}
      {loading ? (
        <div style={{ color: 'var(--muted-foreground)' }}>Loading...</div>
      ) : ranks.length === 0 ? (
        <div style={{ color: 'var(--muted-foreground)' }}>No ranks yet</div>
      ) : (
        <div className="space-y-2">
          {ranks.map((r, idx) => (
            <div
              key={r.id}
              draggable
              onDragStart={() => handleDragStart(idx)}
              onDragOver={(e) => handleDragOver(e, idx)}
              onDrop={() => handleDrop(idx)}
              onDragEnd={handleDragEnd}
              className="p-3 rounded-md border cursor-move"
              style={{
                borderColor: dragState.dragOverIndex === idx ? 'var(--primary)' : 'var(--border)',
                backgroundColor: dragState.draggedIndex === idx ? 'var(--muted)' : 'var(--background)',
                opacity: dragState.draggedIndex === idx ? 0.5 : 1,
              }}
            >
              <div className="grid grid-cols-1 md:grid-cols-5 gap-2 items-center">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-mono" style={{ color: 'var(--muted-foreground)' }}>#{r.orderIndex}</span>
                  <input
                    className="border rounded-md px-2 py-1 flex-1"
                    style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
                    value={r.name}
                    onChange={(e) => {
                      const v = e.target.value;
                      setRanks((list) => list.map((x) => (x.id === r.id ? { ...x, name: v } : x)));
                    }}
                  />
                </div>
                <input
                  className="border rounded-md px-2 py-1"
                  style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
                  placeholder="Abbr."
                  value={r.abbreviation}
                  onChange={(e) => {
                    const v = e.target.value;
                    setRanks((list) => list.map((x) => (x.id === r.id ? { ...x, abbreviation: v } : x)));
                  }}
                />
                <input
                  type="number"
                  className="border rounded-md px-2 py-1"
                  style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
                  placeholder="Attendance"
                  value={r.attendanceRequiredSinceLastRank ?? ''}
                  onChange={(e) => {
                    const val = e.target.value;
                    setRanks((list) => list.map((x) => (x.id === r.id ? { ...x, attendanceRequiredSinceLastRank: val === '' ? null : Number(val) } : x)));
                  }}
                />
                <div className="flex items-center gap-2">
                  <label className="text-sm" style={{ color: 'var(--foreground)' }}>Auto</label>
                  <input
                    type="checkbox"
                    checked={r.autoRankupEnabled}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setRanks((list) => list.map((x) => (x.id === r.id ? { ...x, autoRankupEnabled: checked } : x)));
                    }}
                  />
                </div>
                <div className="flex items-center gap-2 justify-end">
                  <button
                    className="px-3 py-1 rounded-md"
                    style={{ backgroundColor: 'var(--secondary)', color: 'var(--foreground)', border: '1px solid var(--border)' }}
                    onClick={() => updateRank(r)}
                  >
                    Save
                  </button>
                  <button
                    className="px-3 py-1 rounded-md"
                    style={{ backgroundColor: '#ef4444', color: 'white' }}
                    onClick={() => deleteRank(r.id)}
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
          <div className="flex justify-end">
            <button
              className="px-4 py-2 rounded-md"
              style={{ backgroundColor: 'var(--primary)', color: 'var(--primary-foreground)' }}
              onClick={saveOrder}
            >
              Save Order
            </button>
          </div>
        </div>
      )}
      <div className="mt-8 border-t pt-6" style={{ borderColor: 'var(--border)' }}>
        <h3 className="text-lg font-semibold" style={{ color: 'var(--foreground)' }}>Discord rank roles</h3>
        <p className="mb-3 text-sm" style={{ color: 'var(--muted-foreground)' }}>Mappings are isolated by Discord guild. IDs must be 17–20 digit snowflakes.</p>
        <div className="mb-4 flex gap-2">
          <input className="min-w-0 flex-1 rounded border px-3 py-2" style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)', color: 'var(--foreground)' }} placeholder="Discord guild ID" value={discordGuildId} onChange={(event) => setDiscordGuildId(event.target.value.trim())} />
          <button className="rounded px-4 py-2" style={{ backgroundColor: 'var(--primary)', color: 'var(--primary-foreground)' }} onClick={loadDiscordRoles}>Load</button>
        </div>
        <div className="space-y-2">
          {ranks.map((rank) => (
            <div key={rank.id} className="grid gap-2 rounded border p-3 sm:grid-cols-[minmax(10rem,1fr)_minmax(12rem,2fr)_auto]" style={{ borderColor: 'var(--border)' }}>
              <span style={{ color: 'var(--foreground)' }}>[{rank.abbreviation}] {rank.name}</span>
              <input className="rounded border px-2 py-1" style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)', color: 'var(--foreground)' }} placeholder="Discord role ID" value={discordRoles[rank.id] ?? ''} onChange={(event) => setDiscordRoles((current) => ({ ...current, [rank.id]: event.target.value.trim() }))} />
              <div className="flex gap-2"><button className="rounded border px-3 py-1" style={{ borderColor: 'var(--border)' }} onClick={() => saveDiscordRole(rank.id)}>Save</button><button className="rounded border px-3 py-1" style={{ borderColor: 'var(--border)' }} onClick={() => deleteDiscordRole(rank.id)}>Clear</button></div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
