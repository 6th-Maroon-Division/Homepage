'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useToast } from '@/app/components/ui/ToastContainer';
import LoadingSpinner from '@/app/components/ui/LoadingSpinner';

type Subslot = {
  name: string;
  orderIndex: number;
  maxSignups: number;
};

type Slot = {
  name: string;
  orderIndex: number;
  subslots: Subslot[];
};

interface OrbatTemplate {
  id?: number;
  name: string;
  description: string | null;
  category: string | null;
  tagsJson: string | null;
  slotsJson: Slot[];
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

  const handleSave = async () => {
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

  const addSlot = () => {
    const newSlot: Slot = {
      name: '',
      orderIndex: template.slotsJson.length,
      subslots: [],
    };
    setTemplate({
      ...template,
      slotsJson: [...template.slotsJson, newSlot],
    });
  };

  const removeSlot = (index: number) => {
    setTemplate({
      ...template,
      slotsJson: template.slotsJson.filter((_, i) => i !== index),
    });
  };

  const updateSlot = (index: number, field: keyof Slot, value: string | number) => {
    const updatedSlots = [...template.slotsJson];
    updatedSlots[index] = { ...updatedSlots[index], [field]: value };
    setTemplate({ ...template, slotsJson: updatedSlots });
  };

  const addSubslot = (slotIndex: number) => {
    const newSubslot: Subslot = {
      name: '',
      orderIndex: template.slotsJson[slotIndex].subslots.length,
      maxSignups: 1,
    };
    const updatedSlots = [...template.slotsJson];
    updatedSlots[slotIndex].subslots.push(newSubslot);
    setTemplate({ ...template, slotsJson: updatedSlots });
  };

  const removeSubslot = (slotIndex: number, subslotIndex: number) => {
    const updatedSlots = [...template.slotsJson];
    updatedSlots[slotIndex].subslots = updatedSlots[slotIndex].subslots.filter(
      (_, i) => i !== subslotIndex
    );
    setTemplate({ ...template, slotsJson: updatedSlots });
  };

  const updateSubslot = (slotIndex: number, subslotIndex: number, field: keyof Subslot, value: string | number) => {
    const updatedSlots = [...template.slotsJson];
    updatedSlots[slotIndex].subslots[subslotIndex] = {
      ...updatedSlots[slotIndex].subslots[subslotIndex],
      [field]: value,
    };
    setTemplate({ ...template, slotsJson: updatedSlots });
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
            {isNewTemplate ? 'Create Template' : `Edit "${template.name}"`}
          </h1>
          <p style={{ color: 'var(--muted-foreground)' }} className="mt-2">
            {isNewTemplate ? 'Create a new ORBAT template' : 'Modify template details and structure'}
          </p>
        </div>

        {/* Form */}
        <div className="space-y-6">
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

          {/* Slots & Subslots */}
          <div
            className="border rounded-lg p-6"
            style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)' }}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold" style={{ color: 'var(--foreground)' }}>
                Slots & Subslots
              </h2>
              <button
                onClick={addSlot}
                className="px-3 py-1 rounded text-sm font-medium"
                style={{
                  backgroundColor: 'var(--primary)',
                  color: 'white',
                }}
              >
                + Add Slot
              </button>
            </div>

            <div className="space-y-4">
              {template.slotsJson.length === 0 ? (
                <p style={{ color: 'var(--muted-foreground)' }} className="text-center py-4">
                  No slots yet. Add one to get started.
                </p>
              ) : (
                template.slotsJson.map((slot, slotIndex) => (
                  <div
                    key={slotIndex}
                    className="border rounded-lg p-4"
                    style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)' }}
                  >
                    <div className="flex items-end gap-2 mb-4">
                      <div className="flex-1">
                        <label className="block text-sm font-medium mb-1" style={{ color: 'var(--foreground)' }}>
                          Slot Name
                        </label>
                        <input
                          type="text"
                          value={slot.name}
                          onChange={(e) => updateSlot(slotIndex, 'name', e.target.value)}
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
                        onClick={() => removeSlot(slotIndex)}
                        className="px-3 py-1 rounded text-sm font-medium"
                        style={{
                          backgroundColor: '#dc2626',
                          color: 'white',
                        }}
                      >
                        Remove
                      </button>
                    </div>

                    {/* Subslots */}
                    <div className="ml-4 space-y-2 border-l-2 pl-4" style={{ borderColor: 'var(--border)' }}>
                      {slot.subslots.length === 0 ? (
                        <p style={{ color: 'var(--muted-foreground)' }} className="text-sm">
                          No subslots. Add one below.
                        </p>
                      ) : (
                        slot.subslots.map((subslot, subslotIndex) => (
                          <div key={subslotIndex} className="flex items-end gap-2">
                            <input
                              type="text"
                              value={subslot.name}
                              onChange={(e) =>
                                updateSubslot(slotIndex, subslotIndex, 'name', e.target.value)
                              }
                              placeholder="Subslot name"
                              className="flex-1 border rounded px-2 py-1 text-sm"
                              style={{
                                backgroundColor: 'var(--background)',
                                borderColor: 'var(--border)',
                                color: 'var(--foreground)',
                              }}
                            />
                            <input
                              type="number"
                              min="1"
                              value={subslot.maxSignups}
                              onChange={(e) =>
                                updateSubslot(slotIndex, subslotIndex, 'maxSignups', parseInt(e.target.value) || 1)
                              }
                              className="w-16 border rounded px-2 py-1 text-sm"
                              style={{
                                backgroundColor: 'var(--background)',
                                borderColor: 'var(--border)',
                                color: 'var(--foreground)',
                              }}
                            />
                            <button
                              onClick={() => removeSubslot(slotIndex, subslotIndex)}
                              className="px-2 py-1 rounded text-xs font-medium"
                              style={{
                                backgroundColor: '#dc2626',
                                color: 'white',
                              }}
                            >
                              Delete
                            </button>
                          </div>
                        ))
                      )}

                      <button
                        onClick={() => addSubslot(slotIndex)}
                        className="mt-2 text-sm"
                        style={{ color: 'var(--primary)' }}
                      >
                        + Add Subslot
                      </button>
                    </div>
                  </div>
                ))
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
              Cancel
            </button>
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
          </div>
        </div>
      </div>
    </main>
  );
}
