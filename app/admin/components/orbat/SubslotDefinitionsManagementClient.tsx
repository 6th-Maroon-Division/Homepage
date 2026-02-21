'use client';

import { type ChangeEvent, useState } from 'react';
import { useToast } from '@/app/components/ui/ToastContainer';
import { createPortal } from 'react-dom';

type TrainingOption = {
  id: number;
  name: string;
};

type RankOption = {
  id: number;
  name: string;
  abbreviation: string;
  orderIndex: number;
};

type SubslotDefinition = {
  id: number;
  name: string;
  maxSignups: number;
  requiredTrainingIds: number[];
  requiredRankIds: number[];
  requiredTrainingId: number | null;
  requiredRankId: number | null;
  requiredTrainings: { id: number; name: string }[];
  requiredRanks: { id: number; name: string; abbreviation: string; orderIndex?: number }[];
  requiredTraining: { id: number; name: string } | null;
  requiredRank: { id: number; name: string; abbreviation: string } | null;
};

type Props = {
  initialDefinitions: SubslotDefinition[];
  trainings: TrainingOption[];
  ranks: RankOption[];
  isReadOnly?: boolean;
  canCreate?: boolean;
  canEdit?: boolean;
  canDelete?: boolean;
};

export default function SubslotDefinitionsManagementClient({
  initialDefinitions,
  trainings,
  ranks,
  isReadOnly = false,
  canCreate = false,
  canEdit = false,
  canDelete = false,
}: Props) {
  const [definitions, setDefinitions] = useState<SubslotDefinition[]>(initialDefinitions);
  const [isSaving, setIsSaving] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const { showSuccess, showError } = useToast();

  const [form, setForm] = useState<{
    name: string;
    maxSignups: number;
    requiredTrainingIds: number[];
    requiredRankIds: number[];
  }>({
    name: '',
    maxSignups: 1,
    requiredTrainingIds: [],
    requiredRankIds: [],
  });

  const isEditMode = editingId !== null;

  const resetForm = () => {
    setForm({
      name: '',
      maxSignups: 1,
      requiredTrainingIds: [],
      requiredRankIds: [],
    });
  };

  const openCreateModal = () => {
    resetForm();
    setEditingId(null);
    setIsModalOpen(true);
  };

  const openEditModal = (definition: SubslotDefinition) => {
    setEditingId(definition.id);
    setForm({
      name: definition.name,
      maxSignups: definition.maxSignups,
      requiredTrainingIds: definition.requiredTrainingIds || [],
      requiredRankIds: definition.requiredRankIds || [],
    });
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingId(null);
    resetForm();
  };

  const getSelectedNumericValues = (event: ChangeEvent<HTMLSelectElement>) =>
    Array.from(event.target.selectedOptions)
      .map((option) => Number(option.value))
      .filter((value) => Number.isInteger(value) && value > 0);

  const saveDefinition = async () => {
    if (!form.name.trim()) {
      showError('Name is required');
      return;
    }

    setIsSaving(true);
    try {
      const endpoint = isEditMode ? `/api/subslot-definitions/${editingId}` : '/api/subslot-definitions';
      const method = isEditMode ? 'PATCH' : 'POST';

      const response = await fetch(endpoint, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          maxSignups: form.maxSignups,
          requiredTrainingIds: form.requiredTrainingIds,
          requiredRankIds: form.requiredRankIds,
        }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({ error: 'Failed to save subslot definition' }));
        showError(body.error || 'Failed to save subslot definition');
        return;
      }

      const saved: SubslotDefinition = await response.json();
      setDefinitions((prev) => {
        const hasExisting = prev.some((definition) => definition.id === saved.id);
        const next = hasExisting
          ? prev.map((definition) => (definition.id === saved.id ? saved : definition))
          : [...prev, saved];

        return next.sort((a, b) => a.name.localeCompare(b.name));
      });

      closeModal();
      showSuccess(isEditMode ? 'Subslot definition updated' : 'Subslot definition created');
    } catch {
      showError('Network error while saving subslot definition');
    } finally {
      setIsSaving(false);
    }
  };

  const deleteDefinition = async (definitionId: number) => {
    setIsSaving(true);
    try {
      const response = await fetch(`/api/subslot-definitions/${definitionId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({ error: 'Failed to delete subslot definition' }));
        showError(body.error || 'Failed to delete subslot definition');
        return;
      }

      setDefinitions((prev) => prev.filter((definition) => definition.id !== definitionId));
      if (editingId === definitionId) closeModal();
      showSuccess('Subslot definition deleted');
    } catch {
      showError('Network error while deleting subslot definition');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="border rounded-lg p-6" style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)' }}>
        <h1 className="text-2xl font-bold" style={{ color: 'var(--foreground)' }}>Subslot Definitions</h1>
        <p className="text-sm mt-2" style={{ color: 'var(--muted-foreground)' }}>
          {isReadOnly
            ? 'Read-only view of reusable subslots.'
            : 'Create and manage reusable subslots with optional training/rank prerequisites.'}
        </p>
      </div>

      {!isReadOnly && canCreate && (
      <div className="border rounded-lg p-6 space-y-4" style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)' }}>
        <h2 className="text-lg font-semibold" style={{ color: 'var(--foreground)' }}>Create Subslot Definition</h2>
        <button
          type="button"
          onClick={openCreateModal}
          className="px-4 py-2 rounded-md text-sm font-medium"
          style={{ backgroundColor: 'var(--primary)', color: 'var(--primary-foreground)' }}
        >
          New Definition
        </button>
      </div>
      )}

      <div className="border rounded-lg overflow-hidden" style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)' }}>
        <div className="px-6 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
          <h2 className="text-lg font-semibold" style={{ color: 'var(--foreground)' }}>Existing Definitions</h2>
        </div>

        {definitions.length === 0 ? (
          <div className="px-6 py-8 text-sm" style={{ color: 'var(--muted-foreground)' }}>
            No subslot definitions yet.
          </div>
        ) : (
          <div className="space-y-0">
            {definitions.map((definition) => {
              return (
                <div
                  key={definition.id}
                  className="px-6 py-4"
                  style={{ borderBottom: '1px solid var(--border)' }}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="font-medium" style={{ color: 'var(--foreground)' }}>{definition.name}</div>
                      <div className="text-xs mt-1" style={{ color: 'var(--muted-foreground)' }}>
                        Max signups: {definition.maxSignups}
                      </div>
                      <div className="text-xs mt-1" style={{ color: 'var(--muted-foreground)' }}>
                        Trainings: {definition.requiredTrainings.length > 0 ? definition.requiredTrainings.map((training) => training.name).join(', ') : 'None'}
                      </div>
                      <div className="text-xs mt-1" style={{ color: 'var(--muted-foreground)' }}>
                        Ranks: {definition.requiredRanks.length > 0 ? definition.requiredRanks.map((rank) => `[${rank.abbreviation}] ${rank.name}`).join(', ') : 'None'}
                      </div>
                    </div>

                    <div className="flex gap-2">
                      {canEdit && (
                      <button
                        type="button"
                        onClick={() => openEditModal(definition)}
                        className="px-3 py-2 text-xs rounded-md"
                        style={{ backgroundColor: 'var(--primary)', color: 'var(--primary-foreground)' }}
                      >
                        Edit
                      </button>
                      )}
                      {canDelete && (
                      <button
                        type="button"
                        onClick={() => deleteDefinition(definition.id)}
                        disabled={isSaving}
                        className="px-3 py-2 text-xs rounded-md disabled:opacity-50"
                        style={{ backgroundColor: 'var(--muted)', color: 'var(--foreground)' }}
                      >
                        Delete
                      </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {isModalOpen && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0, 0, 0, 0.5)' }}>
          <div className="w-full max-w-2xl border rounded-lg p-6 space-y-4" style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)' }}>
            <h2 className="text-xl font-semibold" style={{ color: 'var(--foreground)' }}>
              {isEditMode ? 'Edit Subslot Definition' : 'Create Subslot Definition'}
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm mb-1" style={{ color: 'var(--foreground)' }}>Name</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                  className="w-full px-3 py-2 border rounded-md text-sm"
                  style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
                />
              </div>

              <div>
                <label className="block text-sm mb-1" style={{ color: 'var(--foreground)' }}>Max signups</label>
                <input
                  type="number"
                  min={1}
                  value={form.maxSignups}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      maxSignups: Math.max(1, Number(e.target.value) || 1),
                    }))
                  }
                  className="w-full px-3 py-2 border rounded-md text-sm"
                  style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
                />
              </div>

              <div>
                <label className="block text-sm mb-1" style={{ color: 'var(--foreground)' }}>
                  Required trainings (multi-select)
                </label>
                <select
                  multiple
                  value={form.requiredTrainingIds.map(String)}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      requiredTrainingIds: getSelectedNumericValues(e),
                    }))
                  }
                  className="w-full px-3 py-2 border rounded-md text-sm h-40"
                  style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
                >
                  {trainings.map((training) => (
                    <option key={training.id} value={training.id}>{training.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm mb-1" style={{ color: 'var(--foreground)' }}>
                  Required ranks (multi-select)
                </label>
                <select
                  multiple
                  value={form.requiredRankIds.map(String)}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      requiredRankIds: getSelectedNumericValues(e),
                    }))
                  }
                  className="w-full px-3 py-2 border rounded-md text-sm h-40"
                  style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
                >
                  {ranks.map((rank) => (
                    <option key={rank.id} value={rank.id}>[{rank.abbreviation}] {rank.name}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={closeModal}
                className="px-4 py-2 rounded-md text-sm"
                style={{ backgroundColor: 'var(--muted)', color: 'var(--foreground)' }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveDefinition}
                disabled={isSaving}
                className="px-4 py-2 rounded-md text-sm font-medium disabled:opacity-50"
                style={{ backgroundColor: 'var(--primary)', color: 'var(--primary-foreground)' }}
              >
                {isSaving ? 'Saving...' : isEditMode ? 'Save Changes' : 'Create'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
