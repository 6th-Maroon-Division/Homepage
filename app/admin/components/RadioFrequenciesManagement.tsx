'use client';

import { useState, useEffect } from 'react';
import { useToast } from '@/app/components/ui/ToastContainer';
import LoadingSpinner from '@/app/components/ui/LoadingSpinner';

type RadioFrequency = {
  id: number;
  frequency: string;
  type: 'SR' | 'LR';
  isAdditional: boolean;
  channel?: string | null;
  callsign?: string | null;
};

export default function RadioFrequenciesManagement() {
  const { showSuccess, showError } = useToast();
  const [frequencies, setFrequencies] = useState<RadioFrequency[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  const [formData, setFormData] = useState<{
    frequency: string;
    type: 'SR' | 'LR';
    isAdditional: boolean;
    channel: string;
    callsign: string;
  }>({
    frequency: '',
    type: 'SR',
    isAdditional: false,
    channel: '',
    callsign: '',
  });

  // Fetch frequencies on mount
  const fetchFrequencies = async () => {
    try {
      setIsLoading(true);
      const response = await fetch('/api/radio-frequencies');
      if (response.ok) {
        const data = await response.json();
        setFrequencies(data);
      } else {
        showError('Failed to fetch radio frequencies');
      }
    } catch (error) {
      console.error('Error fetching frequencies:', error);
      showError('Error loading frequencies');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchFrequencies();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.frequency.trim()) {
      showError('Frequency is required');
      return;
    }

    setIsSaving(true);
    try {
      if (editingId) {
        // Update existing frequency
        const response = await fetch(`/api/radio-frequencies/${editingId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            frequency: formData.frequency.trim(),
            type: formData.type,
            isAdditional: formData.isAdditional,
            channel: formData.channel.trim() || null,
            callsign: formData.callsign.trim() || null,
          }),
        });

        if (response.ok) {
          const updatedFreq = await response.json();
          setFrequencies(frequencies.map((f) => (f.id === editingId ? updatedFreq : f)));
          setFormData({ frequency: '', type: 'SR', isAdditional: false, channel: '', callsign: '' });
          setEditingId(null);
          showSuccess('Radio frequency updated successfully');
        } else {
          showError('Failed to update frequency');
        }
      } else {
        // Create new frequency
        const response = await fetch('/api/radio-frequencies', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            frequency: formData.frequency.trim(),
            type: formData.type,
            isAdditional: formData.isAdditional,
            channel: formData.channel.trim() || null,
            callsign: formData.callsign.trim() || null,
          }),
        });

        if (response.ok) {
          const newFreq = await response.json();
          setFrequencies([...frequencies, newFreq].sort((a, b) => {
            if (a.freqType !== b.freqType) return a.freqType.localeCompare(b.freqType);
            return parseFloat(a.frequency) - parseFloat(b.frequency);
          }));
          setFormData({ frequency: '', type: 'SR', isAdditional: false, channel: '', callsign: '' });
          showSuccess('Radio frequency added successfully');
        } else {
          showError('Failed to add frequency');
        }
      }
    } catch (error) {
      console.error('Error saving frequency:', error);
      showError('Error saving frequency');
    } finally {
      setIsSaving(false);
    }
  };

  const handleEdit = (freq: RadioFrequency) => {
    setFormData({
      frequency: freq.frequency,
      type: freq.type,
      isAdditional: freq.isAdditional,
      channel: freq.channel || '',
      callsign: freq.callsign || '',
    });
    setEditingId(freq.id);
  };

  const handleCancel = () => {
    setFormData({ frequency: '', type: 'SR', isAdditional: false, channel: '', callsign: '' });
    setEditingId(null);
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Are you sure you want to delete this frequency?')) return;

    try {
      const response = await fetch(`/api/radio-frequencies/${id}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        setFrequencies(frequencies.filter((f) => f.id !== id));
        showSuccess('Frequency deleted successfully');
      } else {
        showError('Failed to delete frequency');
      }
    } catch (error) {
      console.error('Error deleting frequency:', error);
      showError('Error deleting frequency');
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="border rounded-lg p-6" style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)' }}>
        <h1 className="text-3xl font-bold" style={{ color: 'var(--foreground)' }}>
          Radio Frequencies
        </h1>
        <p className="text-sm mt-2" style={{ color: 'var(--muted-foreground)' }}>
          Manage radio frequencies that can be assigned to slots and subslots
        </p>
      </div>

      {/* Add/Edit Form */}
      <div className="border rounded-lg p-6 space-y-4" style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)' }}>
        <h2 className="text-xl font-semibold" style={{ color: 'var(--foreground)' }}>
          {editingId ? 'Edit Frequency' : 'Add New Frequency'}
        </h2>

        <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4">
          <div>
            <label className="block text-sm font-medium mb-2" style={{ color: 'var(--muted-foreground)' }}>
              Frequency *
            </label>
            <input
              type="text"
              value={formData.frequency}
              onChange={(e) => setFormData({ ...formData, frequency: e.target.value })}
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2"
              style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
              placeholder="e.g., 70.0"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2" style={{ color: 'var(--muted-foreground)' }}>
              Type *
            </label>
            <select
              value={formData.type}
              onChange={(e) => setFormData({ ...formData, type: e.target.value as 'SR' | 'LR' })}
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2"
              style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
            >
              <option value="SR">SR (Short Range)</option>
              <option value="LR">LR (Long Range)</option>
            </select>
          </div>

          <div className="flex items-end">
            <label className="flex items-center gap-2 cursor-pointer h-full" style={{ color: 'var(--foreground)' }}>
              <input
                type="checkbox"
                checked={formData.isAdditional}
                onChange={(e) => setFormData({ ...formData, isAdditional: e.target.checked })}
                className="w-4 h-4 rounded"
              />
              <span className="text-sm font-medium">Additional (ASR)</span>
            </label>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2" style={{ color: 'var(--muted-foreground)' }}>
              Channel
            </label>
            <input
              type="text"
              value={formData.channel}
              onChange={(e) => setFormData({ ...formData, channel: e.target.value })}
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2"
              style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
              placeholder="e.g., SR Channel 1"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2" style={{ color: 'var(--muted-foreground)' }}>
              Callsign
            </label>
            <input
              type="text"
              value={formData.callsign}
              onChange={(e) => setFormData({ ...formData, callsign: e.target.value })}
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2"
              style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
              placeholder="e.g., Command Net"
            />
          </div>

          <div className="flex items-end gap-2">
            <button
              type="submit"
              disabled={isSaving}
              className="flex-1 px-4 py-2 rounded-md font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              style={{ backgroundColor: 'var(--primary)', color: 'var(--primary-foreground)' }}
            >
              {isSaving && <LoadingSpinner size="sm" />}
              {isSaving ? (editingId ? 'Updating...' : 'Adding...') : editingId ? 'Update' : 'Add'}
            </button>
            {editingId && (
              <button
                type="button"
                onClick={handleCancel}
                className="flex-1 px-4 py-2 rounded-md font-medium transition-colors"
                style={{ backgroundColor: 'var(--border)', color: 'var(--foreground)' }}
              >
                Cancel
              </button>
            )}
          </div>
        </form>
      </div>

      {/* Frequencies List */}
      <div className="border rounded-lg p-6 space-y-4" style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)' }}>
        <h2 className="text-xl font-semibold" style={{ color: 'var(--foreground)' }}>Frequencies</h2>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <LoadingSpinner size="md" />
          </div>
        ) : frequencies.length === 0 ? (
          <p style={{ color: 'var(--muted-foreground)' }}>No radio frequencies added yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  <th className="text-left px-4 py-2 font-medium" style={{ color: 'var(--muted-foreground)' }}>
                    Frequency
                  </th>
                  <th className="text-left px-4 py-2 font-medium" style={{ color: 'var(--muted-foreground)' }}>
                    Type
                  </th>
                  <th className="text-left px-4 py-2 font-medium" style={{ color: 'var(--muted-foreground)' }}>
                    Additional
                  </th>
                  <th className="text-left px-4 py-2 font-medium" style={{ color: 'var(--muted-foreground)' }}>
                    Channel
                  </th>
                  <th className="text-left px-4 py-2 font-medium" style={{ color: 'var(--muted-foreground)' }}>
                    Callsign
                  </th>
                  <th className="text-left px-4 py-2 font-medium" style={{ color: 'var(--muted-foreground)' }}>
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {frequencies.map((freq) => (
                  <tr key={freq.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td className="px-4 py-3 font-medium" style={{ color: 'var(--foreground)' }}>
                      {freq.frequency}
                    </td>
                    <td className="px-4 py-3" style={{ color: 'var(--foreground)' }}>
                      {freq.type}
                    </td>
                    <td className="px-4 py-3" style={{ color: 'var(--foreground)' }}>
                      {freq.isAdditional ? 'ASR' : '-'}
                    </td>
                    <td className="px-4 py-3" style={{ color: 'var(--foreground)' }}>
                      {freq.channel || '-'}
                    </td>
                    <td className="px-4 py-3" style={{ color: 'var(--foreground)' }}>
                      {freq.callsign || '-'}
                    </td>
                    <td className="px-4 py-3 space-x-2">
                      <button
                        onClick={() => handleEdit(freq)}
                        className="text-sm font-medium px-3 py-1 rounded transition-colors"
                        style={{ color: 'var(--primary)' }}
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDelete(freq.id)}
                        className="text-sm font-medium px-3 py-1 rounded transition-colors"
                        style={{ color: '#ef4444' }}
                      >
                        Delete
                      </button>
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
