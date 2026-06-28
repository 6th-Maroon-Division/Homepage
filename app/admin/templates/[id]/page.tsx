'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useToast } from '@/app/components/ui/ToastContainer';
import LoadingSpinner from '@/app/components/ui/LoadingSpinner';
import { usePermission, usePermissionLoading } from '@/app/hooks/usePermissions';

type TemplateSlot = {
  name: string;
  orderIndex: number;
  maxSignups: number;
  squadRoleId?: number | null;
  requiredTrainingIds?: number[];
  requiredRankIds?: number[];
  requiredTrainingId?: number | null;
  requiredRankId?: number | null;
};

type TemplateSquad = {
  name: string;
  orderIndex: number;
  slots: TemplateSlot[];
};

interface OrbatTemplate {
  id?: number;
  name: string;
  description: string | null;
  category: string | null;
  tagsJson: string | null;
  slotsJson: TemplateSquad[];
  frequencyIds: number[];
  bluforCountry: string | null;
  bluforRelationship: string | null;
  opforCountry: string | null;
  opforRelationship: string | null;
  indepCountry: string | null;
  indepRelationship: string | null;
  iedThreat: string | null;
  civilianRelationship: string | null;
  rulesOfEngagement: string | null;
  airspace: string | null;
  inGameTimezone: string | null;
  operationDay: string | null;
  startTime: string | null;
  endTime: string | null;
}

export default function TemplateEditor() {
  const router = useRouter();
  const params = useParams();
  const isNewTemplate = params.id === 'new';

  const [isLoading, setIsLoading] = useState(!isNewTemplate);
  const [isSaving, setIsSaving] = useState(false);
  const { showError, showSuccess } = useToast();
  const canCreateTemplate = usePermission('template:create');
  const canEditTemplate = usePermission('template:edit');
  const isPermissionLoading = usePermissionLoading();
  const isReadOnly = !isNewTemplate && !canEditTemplate;
  const [subslotDefinitions, setSubslotDefinitions] = useState<Array<{
    id: number;
    name: string;
    maxSignups: number;
    requiredTrainingIds?: number[];
    requiredRankIds?: number[];
    requiredTrainings?: Array<{ id: number; name: string }>;
    requiredRanks?: Array<{ id: number; name: string; abbreviation: string }>;
    requiredTraining: { id: number; name: string } | null;
    requiredRank: { id: number; name: string; abbreviation: string } | null;
    isRetired?: boolean;
  }>>([]);
  const [slotSearchBySquad, setSlotSearchBySquad] = useState<Record<number, string>>({});
  const [selectedDefinitionBySquad, setSelectedDefinitionBySquad] = useState<Record<number, string>>({});
  const [draggedSlot, setDraggedSlot] = useState<{ squadIndex: number; slotIndex: number } | null>(null);
  const [dragOverTarget, setDragOverTarget] = useState<{ squadIndex: number; slotIndex: number | null } | null>(null);
  const [draggedSquadIndex, setDraggedSquadIndex] = useState<number | null>(null);
  const [dragOverSquadIndex, setDragOverSquadIndex] = useState<number | null>(null);

  const [template, setTemplate] = useState<OrbatTemplate>({
    name: '',
    description: null,
    category: null,
    tagsJson: null,
    slotsJson: [],
    frequencyIds: [],
    bluforCountry: null,
    bluforRelationship: null,
    opforCountry: null,
    opforRelationship: null,
    indepCountry: null,
    indepRelationship: null,
    iedThreat: null,
    civilianRelationship: null,
    rulesOfEngagement: null,
    airspace: null,
    inGameTimezone: null,
    operationDay: null,
    startTime: null,
    endTime: null,
  });

  // Fetch template if editing
  useEffect(() => {
    if (!isNewTemplate) {
      const fetchTemplate = async () => {
        try {
          const response = await fetch(`/api/templates/${params.id}`);
          if (!response.ok) throw new Error('Failed to fetch template');
          const data = await response.json();
          // Parse slotsJson if it's a string
          if (typeof data.slotsJson === 'string') {
            data.slotsJson = JSON.parse(data.slotsJson);
          }
          setTemplate(data);
        } catch (error) {
          console.error('Error fetching template:', error);
          showError('Failed to load template');
          router.push('/admin/templates');
        } finally {
          setIsLoading(false);
        }
      };

      fetchTemplate();
    }
  }, [isNewTemplate, params.id, router, showError]);

  useEffect(() => {
    const fetchSubslotDefinitions = async () => {
      try {
        const response = await fetch('/api/subslot-definitions');
        if (!response.ok) return;
        const data = await response.json();
        setSubslotDefinitions(data);
      } catch (error) {
        console.error('Error fetching subslot definitions:', error);
      }
    };

    fetchSubslotDefinitions();
  }, []);

  useEffect(() => {
    if (isPermissionLoading) {
      return;
    }

    if (isNewTemplate && !canCreateTemplate) {
      showError('You do not have permission to create templates');
      router.push('/admin/templates');
    }
  }, [isPermissionLoading, isNewTemplate, canCreateTemplate, router, showError]);

  const handleSave = async () => {
    if (isReadOnly) {
      showError('Read-only mode: you cannot modify this template');
      return;
    }

    if (!template.name.trim()) {
      showError('Template name is required');
      return;
    }

    if (template.slotsJson.length === 0) {
      showError('At least one slot is required');
      return;
    }

    setIsSaving(true);

    try {
      const url = isNewTemplate ? '/api/templates' : `/api/templates/${template.id}`;
      const method = isNewTemplate ? 'POST' : 'PUT';

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(template),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to save template');
      }

      showSuccess(
        isNewTemplate ? 'Template created successfully' : 'Template updated successfully'
      );
      router.push('/admin/templates');
    } catch (error) {
      console.error('Error saving template:', error);
      showError(error instanceof Error ? error.message : 'Failed to save template');
    } finally {
      setIsSaving(false);
    }
  };

  const addSquad = () => {
    const newSquad: TemplateSquad = {
      name: '',
      orderIndex: template.slotsJson.length,
      slots: [],
    };
    setTemplate({
      ...template,
      slotsJson: normalizeOrderIndexes([...template.slotsJson, newSquad]),
    });
  };

  const removeSquad = (index: number) => {
    setTemplate({
      ...template,
      slotsJson: normalizeOrderIndexes(template.slotsJson.filter((_, i) => i !== index)),
    });
  };

  const normalizeOrderIndexes = (squads: TemplateSquad[]) =>
    squads.map((squad, squadIndex) => ({
      ...squad,
      orderIndex: squadIndex,
      slots: squad.slots.map((slot, slotIndex) => ({
        ...slot,
        orderIndex: slotIndex,
      })),
    }));

  const updateSquad = (index: number, field: keyof TemplateSquad, value: string | number) => {
    const updatedSlots = [...template.slotsJson];
    updatedSlots[index] = { ...updatedSlots[index], [field]: value };
    setTemplate({ ...template, slotsJson: updatedSlots });
  };

  const addSlotFromDefinition = (squadIndex: number, definitionId: number) => {
    const definition = subslotDefinitions.find((item) => item.id === definitionId);
    if (!definition) {
      showError('Selected role definition was not found');
      return;
    }

    const alreadyAdded = template.slotsJson[squadIndex].slots.some(
      (slot) => slot.squadRoleId === definition.id
    );

    if (alreadyAdded) {
      showError('This slot is already added to the squad');
      return;
    }

    const newSlot: TemplateSlot = {
      name: definition.name,
      orderIndex: template.slotsJson[squadIndex].slots.length,
      maxSignups: definition.maxSignups,
      squadRoleId: definition.id,
      requiredTrainingIds:
        definition.requiredTrainingIds && definition.requiredTrainingIds.length > 0
          ? definition.requiredTrainingIds
          : definition.requiredTraining
            ? [definition.requiredTraining.id]
            : [],
      requiredRankIds:
        definition.requiredRankIds && definition.requiredRankIds.length > 0
          ? definition.requiredRankIds
          : definition.requiredRank
            ? [definition.requiredRank.id]
            : [],
      requiredTrainingId: definition.requiredTraining?.id ?? null,
      requiredRankId: definition.requiredRank?.id ?? null,
    };
    const updatedSlots = [...template.slotsJson];
    updatedSlots[squadIndex].slots.push(newSlot);
    setTemplate({ ...template, slotsJson: normalizeOrderIndexes(updatedSlots) });
    setSelectedDefinitionBySquad((prev) => ({ ...prev, [squadIndex]: '' }));
  };

  const updateSlotMaxSignups = (squadIndex: number, slotIndex: number, maxSignups: number) => {
    const updatedSlots = [...template.slotsJson];
    updatedSlots[squadIndex].slots[slotIndex] = {
      ...updatedSlots[squadIndex].slots[slotIndex],
      maxSignups,
    };
    setTemplate({ ...template, slotsJson: updatedSlots });
  };

  const removeSlot = (squadIndex: number, slotIndex: number) => {
    const updatedSlots = [...template.slotsJson];
    updatedSlots[squadIndex].slots = updatedSlots[squadIndex].slots.filter(
      (_, i) => i !== slotIndex
    );
    setTemplate({ ...template, slotsJson: normalizeOrderIndexes(updatedSlots) });
  };

  const moveSlotByDrag = (
    fromSquadIndex: number,
    fromSlotIndex: number,
    toSquadIndex: number,
    toSlotIndex: number | null
  ) => {
    const nextSquads = [...template.slotsJson];
    const fromSlots = [...nextSquads[fromSquadIndex].slots];
    const [movingSlot] = fromSlots.splice(fromSlotIndex, 1);

    if (!movingSlot) return;

    nextSquads[fromSquadIndex] = {
      ...nextSquads[fromSquadIndex],
      slots: fromSlots,
    };

    const toSlots = [...nextSquads[toSquadIndex].slots];
    if (toSlotIndex === null || toSlotIndex >= toSlots.length) {
      toSlots.push(movingSlot);
    } else {
      let insertIndex = toSlotIndex;
      if (fromSquadIndex === toSquadIndex && fromSlotIndex < toSlotIndex) {
        insertIndex -= 1;
      }
      toSlots.splice(Math.max(0, insertIndex), 0, movingSlot);
    }

    nextSquads[toSquadIndex] = {
      ...nextSquads[toSquadIndex],
      slots: toSlots,
    };

    setTemplate({ ...template, slotsJson: normalizeOrderIndexes(nextSquads) });
  };

  const handleSlotDragStart = (squadIndex: number, slotIndex: number) => {
    setDraggedSlot({ squadIndex, slotIndex });
  };

  const handleSlotDragEnd = () => {
    setDraggedSlot(null);
    setDragOverTarget(null);
  };

  const handleSlotDrop = (squadIndex: number, slotIndex: number | null) => {
    if (!draggedSlot) return;

    if (
      draggedSlot.squadIndex === squadIndex &&
      slotIndex !== null &&
      draggedSlot.slotIndex === slotIndex
    ) {
      handleSlotDragEnd();
      return;
    }

    moveSlotByDrag(draggedSlot.squadIndex, draggedSlot.slotIndex, squadIndex, slotIndex);
    handleSlotDragEnd();
  };

  const moveSquadByDrag = (fromSquadIndex: number, toSquadIndex: number | null) => {
    if (toSquadIndex === null) {
      return;
    }

    if (fromSquadIndex === toSquadIndex) {
      return;
    }

    const nextSquads = [...template.slotsJson];
    const [movingSquad] = nextSquads.splice(fromSquadIndex, 1);

    if (!movingSquad) {
      return;
    }

    let insertIndex = toSquadIndex;
    if (fromSquadIndex < toSquadIndex) {
      insertIndex -= 1;
    }

    nextSquads.splice(Math.max(0, insertIndex), 0, movingSquad);
    setTemplate({ ...template, slotsJson: normalizeOrderIndexes(nextSquads) });
  };

  const handleSquadDragStart = (squadIndex: number) => {
    setDraggedSquadIndex(squadIndex);
  };

  const handleSquadDragEnd = () => {
    setDraggedSquadIndex(null);
    setDragOverSquadIndex(null);
  };

  const handleSquadDrop = (squadIndex: number | null) => {
    if (draggedSquadIndex === null) {
      return;
    }

    moveSquadByDrag(draggedSquadIndex, squadIndex);
    handleSquadDragEnd();
  };

  if (isLoading) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <LoadingSpinner />
      </main>
    );
  }

  return (
    <main className="min-h-screen">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {/* Header */}
        <div
          className="border rounded-lg p-6"
          style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)' }}
        >
          <h1 className="text-3xl font-bold" style={{ color: 'var(--foreground)' }}>
            {isNewTemplate ? 'Create Template' : isReadOnly ? `View "${template.name}"` : `Edit "${template.name}"`}
          </h1>
          <p style={{ color: 'var(--muted-foreground)' }} className="mt-2">
            {isNewTemplate
              ? 'Create a new ORBAT template'
              : isReadOnly
                ? 'Read-only template view'
                : 'Modify template details and structure'}
          </p>
        </div>

        {/* Form */}
        <fieldset className="space-y-6" disabled={isReadOnly}>
          {/* Basic Info */}
          <div
            className="border rounded-lg p-6"
            style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)' }}
          >
            <h2 className="text-xl font-bold mb-4" style={{ color: 'var(--foreground)' }}>
              Basic Information
            </h2>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: 'var(--foreground)' }}>
                  Name *
                </label>
                <input
                  type="text"
                  value={template.name}
                  onChange={(e) => setTemplate({ ...template, name: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2"
                  style={{
                    backgroundColor: 'var(--background)',
                    borderColor: 'var(--border)',
                    color: 'var(--foreground)',
                  }}
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: 'var(--foreground)' }}>
                  Description
                </label>
                <textarea
                  value={template.description || ''}
                  onChange={(e) => setTemplate({ ...template, description: e.target.value || null })}
                  className="w-full border rounded-lg px-3 py-2"
                  rows={3}
                  style={{
                    backgroundColor: 'var(--background)',
                    borderColor: 'var(--border)',
                    color: 'var(--foreground)',
                  }}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1" style={{ color: 'var(--foreground)' }}>
                    Category
                  </label>
                  <select
                    value={template.category || ''}
                    onChange={(e) => setTemplate({ ...template, category: e.target.value || null })}
                    className="w-full border rounded-lg px-3 py-2"
                    style={{
                      backgroundColor: 'var(--background)',
                      borderColor: 'var(--border)',
                      color: 'var(--foreground)',
                    }}
                  >
                    <option value="">Select a category</option>
                    <option value="Main Op">Main Op</option>
                    <option value="Side Op">Side Op</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1" style={{ color: 'var(--foreground)' }}>
                    Tags
                  </label>
                  <input
                    type="text"
                    value={template.tagsJson || ''}
                    onChange={(e) => setTemplate({ ...template, tagsJson: e.target.value || null })}
                    placeholder="Comma-separated tags"
                    className="w-full border rounded-lg px-3 py-2"
                    style={{
                      backgroundColor: 'var(--background)',
                      borderColor: 'var(--border)',
                      color: 'var(--foreground)',
                    }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Squads & Slots */}
          <div
            className="border rounded-lg p-6"
            style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)' }}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold" style={{ color: 'var(--foreground)' }}>
                Squads & Slots
              </h2>
              <button
                onClick={addSquad}
                className="px-3 py-1 rounded text-sm font-medium"
                style={{
                  backgroundColor: 'var(--primary)',
                  color: 'white',
                }}
              >
                + Add Squad
              </button>
            </div>

            <div className="space-y-4">
              {template.slotsJson.length === 0 ? (
                <p style={{ color: 'var(--muted-foreground)' }} className="text-center py-4">
                  No squads yet. Add one to get started.
                </p>
              ) : (
                <>
                  {template.slotsJson.map((squad, squadIndex) => (
                    <div
                      key={squadIndex}
                      draggable={draggedSlot === null}
                      onDragStart={() => {
                        if (draggedSlot) return;
                        handleSquadDragStart(squadIndex);
                      }}
                      onDragEnd={handleSquadDragEnd}
                      onDragOver={(e) => {
                        if (draggedSquadIndex === null) return;
                        e.preventDefault();
                      }}
                      onDragEnter={() => {
                        if (draggedSquadIndex === null) return;
                        setDragOverSquadIndex(squadIndex);
                      }}
                      onDrop={(e) => {
                        if (draggedSquadIndex === null) return;
                        e.preventDefault();
                        handleSquadDrop(squadIndex);
                      }}
                      className="border rounded-lg p-4"
                      style={{
                        backgroundColor: 'var(--background)',
                        borderColor: dragOverSquadIndex === squadIndex ? 'var(--primary)' : 'var(--border)',
                        opacity: draggedSquadIndex === squadIndex ? 0.6 : 1,
                      }}
                    >
                    <div className="flex items-end gap-2 mb-4">
                      <div className="flex-1">
                        <label className="block text-sm font-medium mb-1" style={{ color: 'var(--foreground)' }}>
                          Squad Name
                        </label>
                        <input
                          type="text"
                          value={squad.name}
                          onChange={(e) => updateSquad(squadIndex, 'name', e.target.value)}
                          placeholder="e.g., Platoon 1"
                          className="w-full border rounded px-2 py-1"
                          style={{
                            backgroundColor: 'var(--secondary)',
                            borderColor: 'var(--border)',
                            color: 'var(--foreground)',
                          }}
                        />
                      </div>
                      <button
                        onClick={() => removeSquad(squadIndex)}
                        className="px-3 py-1 rounded text-sm font-medium"
                        style={{
                          backgroundColor: '#dc2626',
                          color: 'white',
                        }}
                      >
                        Remove
                      </button>
                    </div>

                    {/* Slots */}
                    <div className="ml-4 space-y-2 border-l-2 pl-4" style={{ borderColor: 'var(--border)' }}>
                      <div className="space-y-2 rounded-md border p-3" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--secondary)' }}>
                        <label className="block text-xs font-medium" style={{ color: 'var(--muted-foreground)' }}>
                          Search slot by name
                        </label>
                        <input
                          type="text"
                          value={slotSearchBySquad[squadIndex] || ''}
                          onChange={(e) =>
                            setSlotSearchBySquad((prev) => ({ ...prev, [squadIndex]: e.target.value }))
                          }
                          className="w-full px-3 py-2 border rounded-md text-sm"
                          style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
                          placeholder="Type to filter slots..."
                        />

                        <div className="flex gap-2">
                          <select
                            value={selectedDefinitionBySquad[squadIndex] || ''}
                            onChange={(e) =>
                              setSelectedDefinitionBySquad((prev) => ({ ...prev, [squadIndex]: e.target.value }))
                            }
                            className="w-full px-3 py-2 border rounded-md text-sm"
                            style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
                          >
                            <option value="">Select slot...</option>
                            {subslotDefinitions
                              .filter((definition) => {
                                // Filter out retired roles
                                if (definition.isRetired) return false;
                                const searchTerm = (slotSearchBySquad[squadIndex] || '').trim().toLowerCase();
                                if (!searchTerm) return true;
                                return definition.name.toLowerCase().includes(searchTerm);
                              })
                              .map((definition) => (
                                <option key={definition.id} value={definition.id}>
                                  {definition.name}
                                </option>
                              ))}
                          </select>

                          <button
                            onClick={() => {
                              const value = selectedDefinitionBySquad[squadIndex];
                              if (!value) return;
                              addSlotFromDefinition(squadIndex, Number(value));
                            }}
                            className="px-3 py-2 rounded text-xs font-medium"
                            style={{ backgroundColor: 'var(--primary)', color: 'var(--primary-foreground)' }}
                            disabled={!selectedDefinitionBySquad[squadIndex]}
                          >
                            Add
                          </button>
                        </div>
                      </div>

                      {squad.slots.length === 0 ? (
                        <div
                          className="text-sm rounded-md border border-dashed px-2 py-2"
                          style={{
                            color: 'var(--muted-foreground)',
                            borderColor:
                              dragOverTarget?.squadIndex === squadIndex && dragOverTarget?.slotIndex === null
                                ? 'var(--primary)'
                                : 'var(--border)',
                          }}
                          onDragOver={(e) => {
                            if (!draggedSlot) return;
                            e.preventDefault();
                          }}
                          onDragEnter={() => {
                            if (!draggedSlot) return;
                            setDragOverTarget({ squadIndex, slotIndex: null });
                          }}
                          onDrop={(e) => {
                            if (!draggedSlot) return;
                            e.preventDefault();
                            handleSlotDrop(squadIndex, null);
                          }}
                        >
                          No slots. Add one below.
                        </div>
                      ) : (
                        <>
                          {squad.slots.map((slot, slotIndex) => (
                          <div
                            key={slotIndex}
                            draggable
                            onDragStart={(e) => {
                              e.stopPropagation();
                              handleSlotDragStart(squadIndex, slotIndex);
                            }}
                            onDragEnd={(e) => {
                              e.stopPropagation();
                              handleSlotDragEnd();
                            }}
                            onDragOver={(e) => {
                              if (!draggedSlot) return;
                              e.preventDefault();
                            }}
                            onDragEnter={() => {
                              if (!draggedSlot) return;
                              setDragOverTarget({ squadIndex, slotIndex });
                            }}
                            onDrop={(e) => {
                              if (!draggedSlot) return;
                              e.preventDefault();
                              handleSlotDrop(squadIndex, slotIndex);
                            }}
                            className="cursor-move rounded"
                            style={{
                              outline:
                                dragOverTarget?.squadIndex === squadIndex && dragOverTarget?.slotIndex === slotIndex
                                  ? '1px solid var(--primary)'
                                  : 'none',
                              opacity:
                                draggedSlot?.squadIndex === squadIndex && draggedSlot?.slotIndex === slotIndex
                                  ? 0.6
                                  : 1,
                            }}
                          >
                            <div
                              className="border rounded px-3 py-2 space-y-2"
                              style={{
                                backgroundColor: 'var(--background)',
                                borderColor: 'var(--border)',
                                color: 'var(--foreground)',
                              }}
                            >
                              <div className="font-medium text-sm">{slot.name}</div>
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2">
                                  <label className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
                                    Max signups:
                                  </label>
                                  <input
                                    type="number"
                                    min="1"
                                    value={slot.maxSignups}
                                    onChange={(e) => updateSlotMaxSignups(squadIndex, slotIndex, parseInt(e.target.value) || 1)}
                                    className="w-20 border rounded px-2 py-1 text-xs"
                                    style={{
                                      backgroundColor: 'var(--background)',
                                      borderColor: 'var(--border)',
                                      color: 'var(--foreground)',
                                    }}
                                  />
                                </div>
                                <button
                                  onClick={() => removeSlot(squadIndex, slotIndex)}
                                  className="px-2 py-1 rounded text-xs font-medium"
                                  style={{
                                    backgroundColor: '#dc2626',
                                    color: 'white',
                                  }}
                                >
                                  Delete
                                </button>
                              </div>
                            </div>
                          </div>
                          ))}

                          <div
                            className="rounded-md border border-dashed px-2 py-2 text-xs"
                            style={{
                              color: 'var(--muted-foreground)',
                              borderColor:
                                dragOverTarget?.squadIndex === squadIndex && dragOverTarget?.slotIndex === null
                                  ? 'var(--primary)'
                                  : 'var(--border)',
                            }}
                            onDragOver={(e) => {
                              if (!draggedSlot) return;
                              e.preventDefault();
                            }}
                            onDragEnter={() => {
                              if (!draggedSlot) return;
                              setDragOverTarget({ squadIndex, slotIndex: null });
                            }}
                            onDrop={(e) => {
                              if (!draggedSlot) return;
                              e.preventDefault();
                              handleSlotDrop(squadIndex, null);
                            }}
                          >
                            Drag here to move slot to end of this squad
                          </div>
                        </>
                      )}
                    </div>
                    </div>
                  ))}

                  <div
                    className="rounded-lg border border-dashed px-3 py-6 text-sm"
                    style={{
                      color: 'var(--muted-foreground)',
                      borderColor:
                        dragOverSquadIndex === template.slotsJson.length
                          ? 'var(--primary)'
                          : 'var(--border)',
                    }}
                    onDragOver={(e) => {
                      if (draggedSquadIndex === null) return;
                      e.preventDefault();
                    }}
                    onDragEnter={() => {
                      if (draggedSquadIndex === null) return;
                      setDragOverSquadIndex(template.slotsJson.length);
                    }}
                    onDrop={(e) => {
                      if (draggedSquadIndex === null) return;
                      e.preventDefault();
                      handleSquadDrop(template.slotsJson.length);
                    }}
                  >
                    Drag here to move squad to end
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Faction & Intel Defaults */}
          <div
            className="border rounded-lg p-6"
            style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)' }}
          >
            <h2 className="text-xl font-bold mb-4" style={{ color: 'var(--foreground)' }}>
              Faction & Intel Defaults (Optional)
            </h2>

            <div className="grid grid-cols-2 gap-4">
              {/* BLUFOR */}
              <div>
                <label className="block text-xs font-semibold mb-2 uppercase" style={{ color: 'var(--foreground)' }}>
                  BLUFOR
                </label>
                <input
                  type="text"
                  value={template.bluforCountry || ''}
                  onChange={(e) => setTemplate({ ...template, bluforCountry: e.target.value || null })}
                  placeholder="Country"
                  className="w-full border rounded px-2 py-1 text-sm mb-2"
                  style={{
                    backgroundColor: 'var(--background)',
                    borderColor: 'var(--border)',
                    color: 'var(--foreground)',
                  }}
                />
                <select
                  value={template.bluforRelationship || ''}
                  onChange={(e) => setTemplate({ ...template, bluforRelationship: e.target.value || null })}
                  className="w-full border rounded px-2 py-1 text-sm"
                  style={{
                    backgroundColor: 'var(--background)',
                    borderColor: 'var(--border)',
                    color: 'var(--foreground)',
                  }}
                >
                  <option value="">Select relationship</option>
                  <option value="Friendly">Friendly</option>
                  <option value="Neutral">Neutral</option>
                  <option value="Hostile">Hostile</option>
                </select>
              </div>

              {/* OPFOR */}
              <div>
                <label className="block text-xs font-semibold mb-2 uppercase" style={{ color: 'var(--foreground)' }}>
                  OPFOR
                </label>
                <input
                  type="text"
                  value={template.opforCountry || ''}
                  onChange={(e) => setTemplate({ ...template, opforCountry: e.target.value || null })}
                  placeholder="Country"
                  className="w-full border rounded px-2 py-1 text-sm mb-2"
                  style={{
                    backgroundColor: 'var(--background)',
                    borderColor: 'var(--border)',
                    color: 'var(--foreground)',
                  }}
                />
                <select
                  value={template.opforRelationship || ''}
                  onChange={(e) => setTemplate({ ...template, opforRelationship: e.target.value || null })}
                  className="w-full border rounded px-2 py-1 text-sm"
                  style={{
                    backgroundColor: 'var(--background)',
                    borderColor: 'var(--border)',
                    color: 'var(--foreground)',
                  }}
                >
                  <option value="">Select relationship</option>
                  <option value="Friendly">Friendly</option>
                  <option value="Neutral">Neutral</option>
                  <option value="Hostile">Hostile</option>
                </select>
              </div>

              {/* INDEPENDENT */}
              <div>
                <label className="block text-xs font-semibold mb-2 uppercase" style={{ color: 'var(--foreground)' }}>
                  Independent
                </label>
                <input
                  type="text"
                  value={template.indepCountry || ''}
                  onChange={(e) => setTemplate({ ...template, indepCountry: e.target.value || null })}
                  placeholder="Country"
                  className="w-full border rounded px-2 py-1 text-sm mb-2"
                  style={{
                    backgroundColor: 'var(--background)',
                    borderColor: 'var(--border)',
                    color: 'var(--foreground)',
                  }}
                />
                <select
                  value={template.indepRelationship || ''}
                  onChange={(e) => setTemplate({ ...template, indepRelationship: e.target.value || null })}
                  className="w-full border rounded px-2 py-1 text-sm"
                  style={{
                    backgroundColor: 'var(--background)',
                    borderColor: 'var(--border)',
                    color: 'var(--foreground)',
                  }}
                >
                  <option value="">Select relationship</option>
                  <option value="Friendly">Friendly</option>
                  <option value="Neutral">Neutral</option>
                  <option value="Hostile">Hostile</option>
                </select>
              </div>

              {/* Intel */}
              <div>
                <label className="block text-xs font-semibold mb-2 uppercase" style={{ color: 'var(--foreground)' }}>
                  IED Threat
                </label>
                <select
                  value={template.iedThreat || ''}
                  onChange={(e) => setTemplate({ ...template, iedThreat: e.target.value || null })}
                  className="w-full border rounded px-2 py-1 text-sm mb-2"
                  style={{
                    backgroundColor: 'var(--background)',
                    borderColor: 'var(--border)',
                    color: 'var(--foreground)',
                  }}
                >
                  <option value="">Select threat level</option>
                  <option value="None">None</option>
                  <option value="Low">Low</option>
                  <option value="Medium">Medium</option>
                  <option value="High">High</option>
                  <option value="Very High">Very High</option>
                </select>
                <label className="block text-xs font-semibold mb-2 uppercase" style={{ color: 'var(--foreground)' }}>
                  Civilian Relationship
                </label>
                <select
                  value={template.civilianRelationship || ''}
                  onChange={(e) => setTemplate({ ...template, civilianRelationship: e.target.value || null })}
                  className="w-full border rounded px-2 py-1 text-sm"
                  style={{
                    backgroundColor: 'var(--background)',
                    borderColor: 'var(--border)',
                    color: 'var(--foreground)',
                  }}
                >
                  <option value="">Select relationship</option>
                  <option value="Friendly">Friendly</option>
                  <option value="Neutral">Neutral</option>
                  <option value="Hostile">Hostile</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 mt-4">
              <div>
                <label className="block text-xs font-semibold mb-2 uppercase" style={{ color: 'var(--foreground)' }}>
                  Rules of Engagement
                </label>
                <select
                  value={template.rulesOfEngagement || ''}
                  onChange={(e) => setTemplate({ ...template, rulesOfEngagement: e.target.value || null })}
                  className="w-full border rounded px-2 py-1 text-sm"
                  style={{
                    backgroundColor: 'var(--background)',
                    borderColor: 'var(--border)',
                    color: 'var(--foreground)',
                  }}
                >
                  <option value="">Select ROE</option>
                  <option value="Hold Fire">Hold Fire</option>
                  <option value="Return Fire">Return Fire</option>
                  <option value="PID">PID (Positive Identification)</option>
                  <option value="Weapons Free">Weapons Free</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold mb-2 uppercase" style={{ color: 'var(--foreground)' }}>
                  Airspace
                </label>
                <input
                  type="text"
                  value={template.airspace || ''}
                  onChange={(e) => setTemplate({ ...template, airspace: e.target.value || null })}
                  placeholder="Airspace"
                  className="w-full border rounded px-2 py-1 text-sm"
                  style={{
                    backgroundColor: 'var(--background)',
                    borderColor: 'var(--border)',
                    color: 'var(--foreground)',
                  }}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 mt-4">
              <div>
                <label className="block text-xs font-semibold mb-2 uppercase" style={{ color: 'var(--foreground)' }}>
                  In-Game Timezone
                </label>
                <input
                  type="text"
                  value={template.inGameTimezone || ''}
                  onChange={(e) => setTemplate({ ...template, inGameTimezone: e.target.value || null })}
                  placeholder="e.g., UTC+2"
                  className="border rounded px-2 py-1 text-sm w-full"
                  style={{
                    backgroundColor: 'var(--background)',
                    borderColor: 'var(--border)',
                    color: 'var(--foreground)',
                  }}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-2 uppercase" style={{ color: 'var(--foreground)' }}>
                  Operation Day
                </label>
                <input
                  type="text"
                  value={template.operationDay || ''}
                  onChange={(e) => setTemplate({ ...template, operationDay: e.target.value || null })}
                  placeholder="e.g., Day 1"
                  className="border rounded px-2 py-1 text-sm w-full"
                  style={{
                    backgroundColor: 'var(--background)',
                    borderColor: 'var(--border)',
                    color: 'var(--foreground)',
                  }}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-2 uppercase" style={{ color: 'var(--foreground)' }}>
                  Start Time
                </label>
                <input
                  type="time"
                  value={template.startTime || ''}
                  onChange={(e) => setTemplate({ ...template, startTime: e.target.value || null })}
                  className="border rounded px-2 py-1 text-sm w-full"
                  style={{
                    backgroundColor: 'var(--background)',
                    borderColor: 'var(--border)',
                    color: 'var(--foreground)',
                  }}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-2 uppercase" style={{ color: 'var(--foreground)' }}>
                  End Time
                </label>
                <input
                  type="time"
                  value={template.endTime || ''}
                  onChange={(e) => setTemplate({ ...template, endTime: e.target.value || null })}
                  className="border rounded px-2 py-1 text-sm w-full"
                  style={{
                    backgroundColor: 'var(--background)',
                    borderColor: 'var(--border)',
                    color: 'var(--foreground)',
                  }}
                />
              </div>
            </div>
          </div>
        </fieldset>

          {/* Actions */}
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => router.push('/admin/templates')}
              className="px-6 py-2 rounded-md transition-colors font-medium"
              style={{
                backgroundColor: 'var(--secondary)',
                color: 'var(--foreground)',
              }}
            >
              {isReadOnly ? 'Back' : 'Cancel'}
            </button>
            {!isReadOnly && (
              <button
                onClick={handleSave}
                disabled={isSaving}
                className="px-6 py-2 rounded-md font-medium transition-colors disabled:opacity-50"
                style={{
                  backgroundColor: 'var(--primary)',
                  color: 'var(--primary-foreground)',
                }}
              >
                {isSaving ? 'Saving...' : 'Save Template'}
              </button>
            )}
          </div>
      </div>
    </main>
  );
}
