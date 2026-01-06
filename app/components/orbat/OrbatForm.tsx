'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '../ui/ToastContainer';
import LoadingSpinner from '../ui/LoadingSpinner';

type Subslot = {
  id?: number;
  name: string;
  orderIndex: number;
  maxSignups: number;
  _deleted?: boolean;
};

type Slot = {
  id?: number;
  name: string;
  orderIndex: number;
  subslots: Subslot[];
  _deleted?: boolean;
};

type OrbatData = {
  id?: number;
  name: string;
  description: string;
  eventDate: string;
  startTime?: string;
  endTime?: string;
  slots: Slot[];
};

type OrbatFormProps = {
  mode: 'create' | 'edit';
  initialData?: OrbatData;
};

export default function OrbatForm({ mode, initialData }: OrbatFormProps) {
  const router = useRouter();
  const { showSuccess, showError } = useToast();
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState(initialData?.name || '');
  const [description, setDescription] = useState(initialData?.description || '');
  const [eventDate, setEventDate] = useState(() => {
    if (initialData?.eventDate) return initialData.eventDate;
    // Only try to get from searchParams if we're in create mode and it's the client
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      return params.get('date') || '';
    }
    return '';
  });
  const [startTime, setStartTime] = useState(() => {
    if (initialData?.startTime) return initialData.startTime;
    // Set default time if we have a date parameter
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      return params.get('date') ? '19:00' : '';
    }
    return '';
  });
  const [endTime, setEndTime] = useState(() => {
    if (initialData?.endTime) return initialData.endTime;
    // Set default time if we have a date parameter
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      return params.get('date') ? '21:00' : '';
    }
    return '';
  });
  const [slots, setSlots] = useState<Slot[]>(initialData?.slots || []);

  const addSlot = () => {
    const newOrderIndex = slots.filter((s) => !s._deleted).length;
    setSlots([...slots, { name: '', orderIndex: newOrderIndex, subslots: [] }]);
  };

  const removeSlot = (slotIndex: number) => {
    const newSlots = [...slots];
    if (newSlots[slotIndex].id) {
      // Mark for deletion if it exists in DB
      newSlots[slotIndex]._deleted = true;
    } else {
      // Remove if it's a new slot
      newSlots.splice(slotIndex, 1);
    }
    setSlots(newSlots);
  };

  const updateSlot = (slotIndex: number, field: keyof Slot, value: string) => {
    const newSlots = [...slots];
    (newSlots[slotIndex] as Record<string, unknown>)[field] = value;
    setSlots(newSlots);
  };

  const addSubslot = (slotIndex: number) => {
    const newSlots = [...slots];
    const activeSubslots = newSlots[slotIndex].subslots.filter((s) => !s._deleted);
    const newOrderIndex = activeSubslots.length;
    newSlots[slotIndex].subslots.push({
      name: '',
      orderIndex: newOrderIndex,
      maxSignups: 1,
    });
    setSlots(newSlots);
  };

  const removeSubslot = (slotIndex: number, subslotIndex: number) => {
    const newSlots = [...slots];
    if (newSlots[slotIndex].subslots[subslotIndex].id) {
      // Mark for deletion if it exists in DB
      newSlots[slotIndex].subslots[subslotIndex]._deleted = true;
    } else {
      // Remove if it's new
      newSlots[slotIndex].subslots.splice(subslotIndex, 1);
    }
    setSlots(newSlots);
  };

  const updateSubslot = (
    slotIndex: number,
    subslotIndex: number,
    field: keyof Subslot,
    value: string | number
  ) => {
    const newSlots = [...slots];
    (newSlots[slotIndex].subslots[subslotIndex] as Record<string, unknown>)[field] = value;
    setSlots(newSlots);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setError(null);

    // Validate
    if (!name.trim()) {
      setError('OrbAT name is required');
      setIsSaving(false);
      return;
    }

    // Prevent creating operations in the past
    if (mode === 'create' && eventDate) {
      const selectedDate = new Date(eventDate);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      selectedDate.setHours(0, 0, 0, 0);
      
      if (selectedDate < today) {
        setError('Cannot create operations with past dates');
        setIsSaving(false);
        return;
      }
    }

    const activeSlots = slots.filter((s) => !s._deleted);
    if (activeSlots.length === 0) {
      setError('At least one slot is required');
      setIsSaving(false);
      return;
    }

    for (const slot of activeSlots) {
      if (!slot.name.trim()) {
        setError('All slots must have a name');
        setIsSaving(false);
        return;
      }
      const activeSubslots = slot.subslots.filter((s) => !s._deleted);
      if (activeSubslots.length === 0) {
        setError(`Slot "${slot.name}" must have at least one subslot`);
        setIsSaving(false);
        return;
      }
      for (const subslot of activeSubslots) {
        if (!subslot.name.trim()) {
          setError('All subslots must have a name');
          setIsSaving(false);
          return;
        }
      }
    }

    try {
      const payload = {
        name,
        description,
        eventDate: eventDate || null,
        startTime: startTime || null,
        endTime: endTime || null,
        slots,
      };

      const url = mode === 'create' ? '/api/orbats' : `/api/orbats/${initialData?.id}`;
      const method = mode === 'create' ? 'POST' : 'PATCH';

      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({ error: 'Failed to save OrbAT' }));
        setError(data.error || 'Failed to save OrbAT');
        setIsSaving(false);
        return;
      }

      const result = await response.json();
      showSuccess(`OrbAT ${mode === 'create' ? 'created' : 'updated'} successfully!`);
      router.push(`/orbats/${result.id}`);
      router.refresh();
    } catch (err) {
      console.error('Error saving OrbAT:', err);
      const errorMsg = 'Network error occurred';
      setError(errorMsg);
      showError(errorMsg);
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="border rounded-lg p-6" style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)' }}>
        <h1 className="text-2xl sm:text-3xl font-bold" style={{ color: 'var(--foreground)' }}>
          {mode === 'create' ? 'Create New OrbAT' : 'Edit OrbAT'}
        </h1>
        <p className="text-sm sm:text-base mt-2" style={{ color: 'var(--muted-foreground)' }}>
          {mode === 'create' 
            ? 'Set up a new operation with slots and subslots' 
            : 'Modify operation details, slots, and subslots'}
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {error && (
          <div className="bg-red-900/30 border border-red-800 text-red-400 px-4 py-3 rounded-md">
            {error}
          </div>
        )}

      {/* Basic Info */}
      <div className="border rounded-lg p-6 space-y-4" style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)' }}>
        <h2 className="text-xl font-semibold" style={{ color: 'var(--foreground)' }}>Basic Information</h2>

        <div>
          <label htmlFor="name" className="block text-sm font-medium mb-2" style={{ color: 'var(--muted-foreground)' }}>
            OrbAT Name *
          </label>
          <input
            type="text"
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-3 py-2 border rounded-md shadow-sm focus:outline-none focus:ring-2"
            style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
            placeholder="e.g., Operation Red Dawn"
            required
          />
        </div>

        <div>
          <label htmlFor="description" className="block text-sm font-medium mb-2" style={{ color: 'var(--muted-foreground)' }}>
            Description
          </label>
          <textarea
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="w-full px-3 py-2 border rounded-md shadow-sm focus:outline-none focus:ring-2"
            style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
            placeholder="Brief description of the operation"
          />
        </div>

        <div>
          <label htmlFor="eventDate" className="block text-sm font-medium mb-2" style={{ color: 'var(--muted-foreground)' }}>
            Event Date
          </label>
          <input
            type="date"
            id="eventDate"
            value={eventDate}
            onChange={(e) => setEventDate(e.target.value)}
            min={mode === 'create' ? new Date().toISOString().split('T')[0] : undefined}
            className="w-full px-3 py-2 border rounded-md shadow-sm focus:outline-none focus:ring-2"
            style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="startTime" className="block text-sm font-medium mb-2" style={{ color: 'var(--muted-foreground)' }}>
              Start Time
            </label>
            <input
              type="time"
              id="startTime"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="w-full px-3 py-2 border rounded-md shadow-sm focus:outline-none focus:ring-2"
              style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
            />
          </div>

          <div>
            <label htmlFor="endTime" className="block text-sm font-medium mb-2" style={{ color: 'var(--muted-foreground)' }}>
              End Time
            </label>
            <input
              type="time"
              id="endTime"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              className="w-full px-3 py-2 border rounded-md shadow-sm focus:outline-none focus:ring-2"
              style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
            />
          </div>
        </div>
      </div>

      {/* Slots */}
      <div className="border rounded-lg p-6 space-y-4" style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)' }}>
        <div className="flex justify-between items-center">
          <h2 className="text-xl font-semibold" style={{ color: 'var(--foreground)' }}>Slots & Subslots</h2>
          <button
            type="button"
            onClick={addSlot}
            className="px-4 py-2 rounded-md transition-colors text-sm font-medium"
            style={{ backgroundColor: '#16a34a', color: '#ffffff' }}
          >
            + Add Slot
          </button>
        </div>

        {slots.filter((s) => !s._deleted).length === 0 ? (
          <p className="text-center py-6" style={{ color: 'var(--muted-foreground)' }}>No slots added yet. Click &quot;Add Slot&quot; to start.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {slots.map((slot, slotIndex) =>
              slot._deleted ? null : (
                <div key={slotIndex} className="border rounded-lg p-4 space-y-3 flex flex-col" style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)' }}>
                  <div className="flex gap-3 items-start">
                    <div className="flex-1">
                      <label className="block text-sm font-medium mb-2" style={{ color: 'var(--muted-foreground)' }}>
                        Slot Name *
                      </label>
                      <input
                        type="text"
                        value={slot.name}
                        onChange={(e) => updateSlot(slotIndex, 'name', e.target.value)}
                        className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2"
                        style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
                        placeholder="e.g., Command Element, Rifle Platoon"
                        required
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => removeSlot(slotIndex)}
                      className="mt-8 px-3 py-2"
                      style={{ color: '#ef4444' }}
                      title="Remove slot"
                    >
                      Remove
                    </button>
                  </div>

                  {/* Subslots */}
                  <div className="ml-4 space-y-2">
                    <div className="flex justify-between items-center">
                      <h4 className="text-sm font-medium" style={{ color: 'var(--muted-foreground)' }}>Subslots</h4>
                      <button
                        type="button"
                        onClick={() => addSubslot(slotIndex)}
                        className="px-3 py-1 rounded text-xs font-medium"
                        style={{ backgroundColor: 'var(--primary)', color: 'var(--primary-foreground)' }}
                      >
                        + Add Subslot
                      </button>
                    </div>

                    {slot.subslots.filter((s) => !s._deleted).length === 0 ? (
                      <p className="text-sm py-2" style={{ color: 'var(--muted-foreground)' }}>No subslots</p>
                    ) : (
                      slot.subslots.map((subslot, subslotIndex) =>
                        subslot._deleted ? null : (
                          <div key={subslotIndex} className="flex gap-2 items-end">
                            <div className="flex-1">
                              <input
                                type="text"
                                value={subslot.name}
                                onChange={(e) =>
                                  updateSubslot(slotIndex, subslotIndex, 'name', e.target.value)
                                }
                                className="w-full px-3 py-2 border rounded-md text-sm focus:outline-none focus:ring-2"
                                style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
                                placeholder="e.g., Platoon Leader, Squad Leader"
                                required
                              />
                            </div>
                            <div className="w-24">
                              <input
                                type="number"
                                min="1"
                                value={subslot.maxSignups}
                                onChange={(e) =>
                                  updateSubslot(
                                    slotIndex,
                                    subslotIndex,
                                    'maxSignups',
                                    parseInt(e.target.value) || 1
                                  )
                                }
                                className="w-full px-3 py-2 border rounded-md text-sm focus:outline-none focus:ring-2"
                                style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
                                title="Max signups"
                              />
                            </div>
                            <button
                              type="button"
                              onClick={() => removeSubslot(slotIndex, subslotIndex)}
                              className="px-3 py-2 text-sm"
                              style={{ color: '#ef4444' }}
                              title="Remove subslot"
                            >
                              ×
                            </button>
                          </div>
                        )
                      )
                    )}
                  </div>
                </div>
              )
            )}
          </div>
        )}
      </div>

      {/* Submit */}
      <div className="flex justify-end gap-3">
        <button
          type="button"
          onClick={() => router.back()}
          className="px-6 py-2 rounded-md transition-colors font-medium"
          style={{ backgroundColor: 'var(--secondary)', color: 'var(--foreground)' }}
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isSaving}
          className="px-6 py-2 rounded-md transition-colors font-medium flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ backgroundColor: 'var(--primary)', color: 'var(--primary-foreground)' }}
        >
          {isSaving && <LoadingSpinner size="sm" />}
          {isSaving ? 'Saving...' : mode === 'create' ? 'Create OrbAT' : 'Save Changes'}
        </button>
      </div>
    </form>
    </div>
  );
}
