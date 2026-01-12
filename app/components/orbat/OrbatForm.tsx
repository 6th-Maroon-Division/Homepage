'use client';

import { useState, useEffect } from 'react';
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
  bluforCountry?: string | null;
  bluforRelationship?: string | null;
  opforCountry?: string | null;
  opforRelationship?: string | null;
  indepCountry?: string | null;
  indepRelationship?: string | null;
  iedThreat?: string | null;
  civilianRelationship?: string | null;
  rulesOfEngagement?: string | null;
  airspace?: string | null;
  inGameTimezone?: string | null;
  operationDay?: string | null;
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
  const [bluforCountry, setBluforCountry] = useState(initialData?.bluforCountry || '');
  const [bluforRelationship, setBluforRelationship] = useState(initialData?.bluforRelationship || '');
  const [opforCountry, setOpforCountry] = useState(initialData?.opforCountry || '');
  const [opforRelationship, setOpforRelationship] = useState(initialData?.opforRelationship || '');
  const [indepCountry, setIndepCountry] = useState(initialData?.indepCountry || '');
  const [indepRelationship, setIndepRelationship] = useState(initialData?.indepRelationship || '');
  const [iedThreat, setIedThreat] = useState(initialData?.iedThreat || '');
  const [civilianRelationship, setCivilianRelationship] = useState(initialData?.civilianRelationship || '');
  const [rulesOfEngagement, setRulesOfEngagement] = useState(initialData?.rulesOfEngagement || '');
  const [airspace, setAirspace] = useState(initialData?.airspace || '');
  const [inGameTimezone, setInGameTimezone] = useState(initialData?.inGameTimezone || '');
  const [operationDay, setOperationDay] = useState(initialData?.operationDay || '');
  const [slots, setSlots] = useState<Slot[]>(initialData?.slots || []);
  const [radioFrequencies, setRadioFrequencies] = useState<Array<{
    id: number;
    frequency: string;
    type: string;
    isAdditional: boolean;
    channel?: string | null;
    callsign?: string | null;
  }>>([]);
  
  // Temporary frequencies for this operation
  type TempFrequency = {
    _id: string;
    frequency: string;
    type: 'SR' | 'LR';
    isAdditional: boolean;
    channel: string;
    callsign: string;
  };
  const [tempFrequencies, setTempFrequencies] = useState<TempFrequency[]>([]);
  const [selectedFrequencyIds, setSelectedFrequencyIds] = useState<number[]>([]);
  const [tempFreqForm, setTempFreqForm] = useState({
    frequency: '',
    type: 'SR' as 'SR' | 'LR',
    isAdditional: false,
    channel: '',
    callsign: '',
  });
  const [isAddingTempFreq, setIsAddingTempFreq] = useState(false);
  const [templates, setTemplates] = useState<Array<{ id: number; name: string; category: string | null }>>([]);
  const [recentOrbats, setRecentOrbats] = useState<Array<{ id: number; name: string }>>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<string>('');
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(true);

  // Fetch radio frequencies on mount
  useEffect(() => {
    // Fetch templates
    const fetchTemplates = async () => {
      try {
        const response = await fetch('/api/templates');
        if (response.ok) {
          const data = await response.json();
          setTemplates(data);
        }
      } catch (error) {
        console.error('Error fetching templates:', error);
      }
    };

    // Fetch recent orbats
    const fetchRecentOrbats = async () => {
      try {
        const response = await fetch('/api/orbats?limit=5');
        if (response.ok) {
          const data = await response.json();
          setRecentOrbats(data);
        }
      } catch (error) {
        console.error('Error fetching recent orbats:', error);
      }
    };

    Promise.all([fetchTemplates(), fetchRecentOrbats()]).finally(() => {
      setIsLoadingTemplates(false);
    });
  }, []);

  const handleLoadTemplate = async () => {
    if (!selectedTemplate) return;
    
    let templateType: 'template' | 'orbat' = 'template';
    let templateId = selectedTemplate;
    
    if (selectedTemplate.includes('-')) {
      const [type, id] = selectedTemplate.split('-');
      templateType = type as 'template' | 'orbat';
      templateId = id;
    }
    
    const endpoint = templateType === 'template' 
      ? `/api/templates/${templateId}`
      : `/api/orbats/${templateId}`;
    
    try {
      const response = await fetch(endpoint);
      if (response.ok) {
        const data = await response.json();
        
        // Pre-fill form with template data
        if (data.name) setName(`${data.name} - Copy`);
        if (data.description) setDescription(data.description);
        
        // Handle slots - for templates use slotsJson, for orbats use slots
        let slots = null;
        if (data.slotsJson) {
          slots = data.slotsJson;
          if (typeof slots === 'string') {
            slots = JSON.parse(slots);
          }
        } else if (data.slots) {
          slots = data.slots;
        }
        if (slots) setSlots(slots);
        
        if (data.bluforCountry) setBluforCountry(data.bluforCountry);
        if (data.bluforRelationship) setBluforRelationship(data.bluforRelationship);
        if (data.opforCountry) setOpforCountry(data.opforCountry);
        if (data.opforRelationship) setOpforRelationship(data.opforRelationship);
        if (data.indepCountry) setIndepCountry(data.indepCountry);
        if (data.indepRelationship) setIndepRelationship(data.indepRelationship);
        if (data.iedThreat) setIedThreat(data.iedThreat);
        if (data.civilianRelationship) setCivilianRelationship(data.civilianRelationship);
        if (data.rulesOfEngagement) setRulesOfEngagement(data.rulesOfEngagement);
        if (data.airspace) setAirspace(data.airspace);
        if (data.inGameTimezone) setInGameTimezone(data.inGameTimezone);
        if (data.operationDay) setOperationDay(data.operationDay);
        if (data.startTime) setStartTime(data.startTime);
        if (data.endTime) setEndTime(data.endTime);
        
        showSuccess(`${templateType === 'template' ? 'Template' : 'OrbAT'} loaded successfully`);
        setSelectedTemplate('');
      }
    } catch (error) {
      console.error('Error loading template:', error);
      showError(`Failed to load ${templateType}`);
    }
  };

  // Fetch radio frequencies on mount
  useEffect(() => {
    // Load template if templateId is in query params

    const loadTemplateFromQueryParam = async () => {
      if (typeof window !== 'undefined') {
        const params = new URLSearchParams(window.location.search);
        const templateId = params.get('templateId');
        
        if (templateId && mode === 'create') {
          try {
            const response = await fetch(`/api/templates/${templateId}`);
            if (response.ok) {
              const template = await response.json();
              
              // Pre-fill form with template data
              if (template.name) setName(`${template.name} - Copy`);
              if (template.description) setDescription(template.description);
              if (template.slotsJson) {
                // Parse slots if needed
                let parsedSlots = template.slotsJson;
                if (typeof parsedSlots === 'string') {
                  parsedSlots = JSON.parse(parsedSlots);
                }
                setSlots(parsedSlots);
              }
              if (template.bluforCountry) setBluforCountry(template.bluforCountry);
              if (template.bluforRelationship) setBluforRelationship(template.bluforRelationship);
              if (template.opforCountry) setOpforCountry(template.opforCountry);
              if (template.opforRelationship) setOpforRelationship(template.opforRelationship);
              if (template.indepCountry) setIndepCountry(template.indepCountry);
              if (template.indepRelationship) setIndepRelationship(template.indepRelationship);
              if (template.iedThreat) setIedThreat(template.iedThreat);
              if (template.civilianRelationship) setCivilianRelationship(template.civilianRelationship);
              if (template.rulesOfEngagement) setRulesOfEngagement(template.rulesOfEngagement);
              if (template.airspace) setAirspace(template.airspace);
              if (template.inGameTimezone) setInGameTimezone(template.inGameTimezone);
              if (template.operationDay) setOperationDay(template.operationDay);
              if (template.startTime) setStartTime(template.startTime);
              if (template.endTime) setEndTime(template.endTime);
              
              showSuccess('Template loaded successfully');
            }
          } catch (error) {
            console.error('Error loading template:', error);
            showError('Failed to load template');
          }
        }
      }
    };

    loadTemplateFromQueryParam();
  }, [mode, showSuccess, showError]);

  useEffect(() => {
    const fetchFrequencies = async () => {
      try {
        const response = await fetch('/api/radio-frequencies');
        if (response.ok) {
          const data = await response.json();
          setRadioFrequencies(data);
        }
      } catch (error) {
        console.error('Error fetching radio frequencies:', error);
      }
    };

    // Load existing frequencies if editing
    if (mode === 'edit' && initialData?.id) {
      const fetchOrbatFrequencies = async () => {
        try {
          const response = await fetch(`/api/orbats/${initialData.id}/full`);
          if (response.ok) {
            const orbat = await response.json();
            if (orbat.frequencies) {
              const freqIds = orbat.frequencies.map((f: { radioFrequencyId: number }) => f.radioFrequencyId);
              setSelectedFrequencyIds(freqIds);
            }
            if (orbat.tempFrequencies && Array.isArray(orbat.tempFrequencies) && orbat.tempFrequencies.length > 0) {
              // Load temporary frequencies from the orbat
              const loadedTempFreqs = orbat.tempFrequencies.map((f: { _id?: string; frequency: string; type: 'SR' | 'LR'; isAdditional: boolean; channel?: string; callsign?: string }) => ({
                _id: f._id || Math.random().toString(36).substr(2, 9),
                frequency: f.frequency,
                type: f.type,
                isAdditional: f.isAdditional,
                channel: f.channel || '',
                callsign: f.callsign || '',
              }));
              setTempFrequencies(loadedTempFreqs);
            }
          }
        } catch (error) {
          console.error('Error fetching orbat frequencies:', error);
        }
      };
      fetchOrbatFrequencies();
    }

    fetchFrequencies();
  }, [mode, initialData?.id]);

  const addTempFrequency = () => {
    if (!tempFreqForm.frequency.trim()) {
      showError('Frequency is required');
      return;
    }

    const newFreq: TempFrequency = {
      _id: Math.random().toString(36).substr(2, 9),
      frequency: tempFreqForm.frequency.trim(),
      type: tempFreqForm.type,
      isAdditional: tempFreqForm.isAdditional,
      channel: tempFreqForm.channel.trim(),
      callsign: tempFreqForm.callsign.trim(),
    };

    setTempFrequencies([...tempFrequencies, newFreq]);
    setTempFreqForm({
      frequency: '',
      type: 'SR',
      isAdditional: false,
      channel: '',
      callsign: '',
    });
  };

  const removeTempFrequency = (id: string) => {
    setTempFrequencies(tempFrequencies.filter((f) => f._id !== id));
  };

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
    value: string | number | null
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
        frequencyIds: selectedFrequencyIds,
        tempFrequencies,
        bluforCountry: bluforCountry || null,
        bluforRelationship: bluforRelationship || null,
        opforCountry: opforCountry || null,
        opforRelationship: opforRelationship || null,
        indepCountry: indepCountry || null,
        indepRelationship: indepRelationship || null,
        iedThreat: iedThreat || null,
        civilianRelationship: civilianRelationship || null,
        rulesOfEngagement: rulesOfEngagement || null,
        airspace: airspace || null,
        inGameTimezone: inGameTimezone || null,
        operationDay: operationDay || null,
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

      {/* Template Loader */}
      <div className="border rounded-lg overflow-hidden" style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)' }}>
        <div className="px-6 py-4 flex justify-between items-center" style={{ borderBottomWidth: '1px', borderColor: 'var(--border)' }}>
          <div>
            <h2 className="text-lg font-semibold" style={{ color: 'var(--foreground)' }}>Load from Template</h2>
            <p className="text-sm mt-1" style={{ color: 'var(--muted-foreground)' }}>
              Pre-fill this form with a saved template
            </p>
          </div>
          <div className="flex gap-2 items-center">
            <select
              value={selectedTemplate}
              onChange={(e) => setSelectedTemplate(e.target.value)}
              disabled={isLoadingTemplates || templates.length === 0}
              className="border rounded-lg px-3 py-2 text-sm"
              style={{
                backgroundColor: 'var(--background)',
                borderColor: 'var(--border)',
                color: 'var(--foreground)',
              }}
            >
              <option value="">
                {isLoadingTemplates ? 'Loading...' : (templates.length === 0 && recentOrbats.length === 0) ? 'No templates available' : 'Select template...'}
              </option>
              
              {/* Templates group */}
              {templates.length > 0 && (
                <optgroup label="Templates">
                  {templates
                    .filter(t => !(mode === 'edit' && initialData?.id && t.id === initialData.id))
                    .map((template) => (
                      <option key={`template-${template.id}`} value={`template-${template.id}`}>
                        {template.name} {template.category ? `(${template.category})` : ''}
                      </option>
                    ))}
                </optgroup>
              )}
              
              {/* Recent OrbATs group */}
              {recentOrbats.length > 0 && (
                <optgroup label="Recent OrbATs">
                  {recentOrbats
                    .filter(o => !(mode === 'edit' && initialData?.id && o.id === initialData.id))
                    .map((orbat) => (
                      <option key={`orbat-${orbat.id}`} value={`orbat-${orbat.id}`}>
                        {orbat.name}
                      </option>
                    ))}
                </optgroup>
              )}
            </select>
            <button
              type="button"
              onClick={handleLoadTemplate}
              disabled={!selectedTemplate || isLoadingTemplates}
              className="px-4 py-2 rounded-lg font-medium transition-colors disabled:opacity-50"
              style={{
                backgroundColor: 'var(--primary)',
                color: 'var(--primary-foreground)',
              }}
              onMouseEnter={(e) => !selectedTemplate || isLoadingTemplates ? null : ((e.currentTarget.style.backgroundColor = 'var(--button-hover)') || (e.currentTarget.style.color = 'var(--button-hover-foreground)'))}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'var(--primary)') || (e.currentTarget.style.color = 'var(--primary-foreground)')}
            >
              Load Template
            </button>
          </div>
        </div>
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

      {/* Factions */}
      <div className="border rounded-lg p-6 space-y-4" style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)' }}>
        <h2 className="text-xl font-semibold" style={{ color: 'var(--foreground)' }}>Factions</h2>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* BLUFOR */}
          <div className="border rounded-lg p-4 space-y-3" style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)' }}>
            <h3 className="font-semibold text-sm" style={{ color: 'var(--foreground)' }}>BLUFOR</h3>
            <div>
              <label htmlFor="bluforCountry" className="block text-xs font-medium mb-1" style={{ color: 'var(--muted-foreground)' }}>
                Country
              </label>
              <input
                type="text"
                id="bluforCountry"
                value={bluforCountry}
                onChange={(e) => setBluforCountry(e.target.value)}
                className="w-full px-3 py-2 border rounded-md text-sm focus:outline-none focus:ring-2"
                style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
                placeholder="e.g., Hungary"
              />
            </div>
            <div>
              <label htmlFor="bluforRelationship" className="block text-xs font-medium mb-1" style={{ color: 'var(--muted-foreground)' }}>
                Relationship
              </label>
              <select
                id="bluforRelationship"
                value={bluforRelationship}
                onChange={(e) => setBluforRelationship(e.target.value)}
                className="w-full px-3 py-2 border rounded-md text-sm focus:outline-none focus:ring-2"
                style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
              >
                <option value="">Select relationship</option>
                <option value="Friendly">Friendly</option>
                <option value="Neutral">Neutral</option>
                <option value="Hostile">Hostile</option>
              </select>
            </div>
          </div>

          {/* OPFOR */}
          <div className="border rounded-lg p-4 space-y-3" style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)' }}>
            <h3 className="font-semibold text-sm" style={{ color: 'var(--foreground)' }}>OPFOR</h3>
            <div>
              <label htmlFor="opforCountry" className="block text-xs font-medium mb-1" style={{ color: 'var(--muted-foreground)' }}>
                Country
              </label>
              <input
                type="text"
                id="opforCountry"
                value={opforCountry}
                onChange={(e) => setOpforCountry(e.target.value)}
                className="w-full px-3 py-2 border rounded-md text-sm focus:outline-none focus:ring-2"
                style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
                placeholder="e.g., Romania"
              />
            </div>
            <div>
              <label htmlFor="opforRelationship" className="block text-xs font-medium mb-1" style={{ color: 'var(--muted-foreground)' }}>
                Relationship
              </label>
              <select
                id="opforRelationship"
                value={opforRelationship}
                onChange={(e) => setOpforRelationship(e.target.value)}
                className="w-full px-3 py-2 border rounded-md text-sm focus:outline-none focus:ring-2"
                style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
              >
                <option value="">Select relationship</option>
                <option value="Friendly">Friendly</option>
                <option value="Neutral">Neutral</option>
                <option value="Hostile">Hostile</option>
              </select>
            </div>
          </div>

          {/* Independent */}
          <div className="border rounded-lg p-4 space-y-3" style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)' }}>
            <h3 className="font-semibold text-sm" style={{ color: 'var(--foreground)' }}>Independent</h3>
            <div>
              <label htmlFor="indepCountry" className="block text-xs font-medium mb-1" style={{ color: 'var(--muted-foreground)' }}>
                Country
              </label>
              <input
                type="text"
                id="indepCountry"
                value={indepCountry}
                onChange={(e) => setIndepCountry(e.target.value)}
                className="w-full px-3 py-2 border rounded-md text-sm focus:outline-none focus:ring-2"
                style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
                placeholder="e.g., NATO"
              />
            </div>
            <div>
              <label htmlFor="indepRelationship" className="block text-xs font-medium mb-1" style={{ color: 'var(--muted-foreground)' }}>
                Relationship
              </label>
              <select
                id="indepRelationship"
                value={indepRelationship}
                onChange={(e) => setIndepRelationship(e.target.value)}
                className="w-full px-3 py-2 border rounded-md text-sm focus:outline-none focus:ring-2"
                style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
              >
                <option value="">Select relationship</option>
                <option value="Friendly">Friendly</option>
                <option value="Neutral">Neutral</option>
                <option value="Hostile">Hostile</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Extra Intel */}
      <div className="border rounded-lg p-6 space-y-4" style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)' }}>
        <h2 className="text-xl font-semibold" style={{ color: 'var(--foreground)' }}>Extra Intel</h2>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="iedThreat" className="block text-sm font-medium mb-2" style={{ color: 'var(--muted-foreground)' }}>
              IED/Trap/Mine Threat
            </label>
            <select
              id="iedThreat"
              value={iedThreat}
              onChange={(e) => setIedThreat(e.target.value)}
              className="w-full px-3 py-2 border rounded-md shadow-sm focus:outline-none focus:ring-2"
              style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
            >
              <option value="">Select threat level</option>
              <option value="None">None</option>
              <option value="Low">Low</option>
              <option value="Medium">Medium</option>
              <option value="High">High</option>
              <option value="Very High">Very High</option>
            </select>
          </div>

          <div>
            <label htmlFor="civilianRelationship" className="block text-sm font-medium mb-2" style={{ color: 'var(--muted-foreground)' }}>
              Civilian Relationship
            </label>
            <select
              id="civilianRelationship"
              value={civilianRelationship}
              onChange={(e) => setCivilianRelationship(e.target.value)}
              className="w-full px-3 py-2 border rounded-md shadow-sm focus:outline-none focus:ring-2"
              style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
            >
              <option value="">Select relationship</option>
              <option value="Friendly">Friendly</option>
              <option value="Neutral">Neutral</option>
              <option value="Hostile">Hostile</option>
            </select>
          </div>

          <div>
            <label htmlFor="rulesOfEngagement" className="block text-sm font-medium mb-2" style={{ color: 'var(--muted-foreground)' }}>
              Rules of Engagement
            </label>
            <select
              id="rulesOfEngagement"
              value={rulesOfEngagement}
              onChange={(e) => setRulesOfEngagement(e.target.value)}
              className="w-full px-3 py-2 border rounded-md shadow-sm focus:outline-none focus:ring-2"
              style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
            >
              <option value="">Select ROE</option>
              <option value="Hold Fire">Hold Fire</option>
              <option value="Return Fire">Return Fire</option>
              <option value="PID">PID (Positive Identification)</option>
              <option value="Weapons Free">Weapons Free</option>
            </select>
          </div>

          <div>
            <label htmlFor="airspace" className="block text-sm font-medium mb-2" style={{ color: 'var(--muted-foreground)' }}>
              Airspace
            </label>
            <select
              id="airspace"
              value={airspace}
              onChange={(e) => setAirspace(e.target.value)}
              className="w-full px-3 py-2 border rounded-md shadow-sm focus:outline-none focus:ring-2"
              style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
            >
              <option value="">Select airspace status</option>
              <option value="Friendly">Friendly</option>
              <option value="Contested">Contested</option>
              <option value="Hostile">Hostile</option>
            </select>
          </div>

          <div>
            <label htmlFor="inGameTimezone" className="block text-sm font-medium mb-2" style={{ color: 'var(--muted-foreground)' }}>
              In Game Timezone
            </label>
            <input
              type="text"
              id="inGameTimezone"
              value={inGameTimezone}
              onChange={(e) => setInGameTimezone(e.target.value)}
              className="w-full px-3 py-2 border rounded-md shadow-sm focus:outline-none focus:ring-2"
              style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
              placeholder="e.g., 4:00"
            />
          </div>

          <div>
            <label htmlFor="operationDay" className="block text-sm font-medium mb-2" style={{ color: 'var(--muted-foreground)' }}>
              Operation Day
            </label>
            <input
              type="text"
              id="operationDay"
              value={operationDay}
              onChange={(e) => setOperationDay(e.target.value)}
              className="w-full px-3 py-2 border rounded-md shadow-sm focus:outline-none focus:ring-2"
              style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
              placeholder="e.g., Final Day"
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
                          <div key={subslotIndex} className="border border-gray-600 rounded p-2 space-y-2" style={{ backgroundColor: 'var(--background)' }}>
                            <div className="flex gap-2">
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

      {/* Radio Frequencies for Operation */}
      <div className="border rounded-lg p-6 space-y-4" style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)' }}>
        <h2 className="text-xl font-semibold" style={{ color: 'var(--foreground)' }}>Radio Frequencies</h2>
        <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>Assign radio frequencies for this operation</p>

        {/* Add Existing Frequency Dropdown */}
        <div className="space-y-2 p-4 rounded-md" style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)' }}>
          <label className="block text-sm font-medium" style={{ color: 'var(--muted-foreground)' }}>Add Existing Frequency</label>
          <div className="flex gap-2">
            <select
              onChange={(e) => {
                if (e.target.value) {
                  const freqId = parseInt(e.target.value);
                  if (!selectedFrequencyIds.includes(freqId)) {
                    setSelectedFrequencyIds([...selectedFrequencyIds, freqId]);
                  }
                  e.target.value = '';
                }
              }}
              className="flex-1 px-3 py-2 border rounded-md text-sm focus:outline-none focus:ring-2"
              style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
            >
              <option value="">Select a frequency...</option>
              {radioFrequencies
                .filter((f) => !selectedFrequencyIds.includes(f.id))
                .map((freq) => (
                  <option key={freq.id} value={freq.id}>
                    {freq.frequency} ({freq.type}) {freq.channel ? `- ${freq.channel}` : ''} {freq.callsign ? `/ ${freq.callsign}` : ''}
                  </option>
                ))}
            </select>
            <button
              type="button"
              onClick={() => setIsAddingTempFreq(true)}
              className="px-4 py-2 rounded-md text-sm font-medium transition-colors whitespace-nowrap"
              style={{ backgroundColor: '#16a34a', color: '#ffffff' }}
            >
              + Temporary
            </button>
          </div>
        </div>

        {/* Assigned Frequencies Display */}
        <div className="space-y-2">
          <h3 className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>Assigned Frequencies</h3>
          {selectedFrequencyIds.length === 0 && tempFrequencies.length === 0 ? (
            <div className="p-4 rounded-md border-2 border-dashed text-center" style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)' }}>
              <p style={{ color: 'var(--muted-foreground)' }}>No radio frequencies assigned.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {/* Display selected existing frequencies */}
              {selectedFrequencyIds.map((freqId) => {
                const freq = radioFrequencies.find((f) => f.id === freqId);
                if (!freq) return null;
                return (
                  <div
                    key={`existing-${freqId}`}
                    className="rounded-lg border p-3"
                    style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)' }}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="font-semibold text-lg" style={{ color: 'var(--foreground)' }}>
                        {freq.frequency}
                      </div>
                      <button
                        type="button"
                        onClick={() => setSelectedFrequencyIds(selectedFrequencyIds.filter((id) => id !== freqId))}
                        className="text-lg font-bold"
                        style={{ color: '#ef4444' }}
                        title="Remove"
                      >
                        ×
                      </button>
                    </div>
                    <div className="space-y-1 text-xs" style={{ color: 'var(--muted-foreground)' }}>
                      <div>
                        <span style={{ color: 'var(--primary)' }} className="font-medium">
                          {freq.isAdditional ? 'A' : ''}{freq.type}
                        </span>
                      </div>
                      {freq.callsign && <div>Callsign: {freq.callsign}</div>}
                      {freq.channel && <div>Channel: {freq.channel}</div>}
                    </div>
                  </div>
                );
              })}
              
              {/* Display temporary frequencies */}
              {tempFrequencies.map((freq) => (
                <div
                  key={freq._id}
                  className="rounded-lg border p-3 opacity-75"
                  style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)' }}
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="font-semibold text-lg" style={{ color: 'var(--foreground)' }}>
                      {freq.frequency}
                    </div>
                    <button
                      type="button"
                      onClick={() => removeTempFrequency(freq._id)}
                      className="text-lg font-bold"
                      style={{ color: '#ef4444' }}
                      title="Remove"
                    >
                      ×
                    </button>
                  </div>
                  <div className="space-y-1 text-xs" style={{ color: 'var(--muted-foreground)' }}>
                    <div>
                      <span style={{ color: '#f59e0b' }} className="font-medium">
                        {freq.isAdditional ? 'A' : ''}{freq.type} (Temp)
                      </span>
                    </div>
                    {freq.callsign && <div>Callsign: {freq.callsign}</div>}
                    {freq.channel && <div>Channel: {freq.channel}</div>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Add Temporary Frequency Dialog */}
        {isAddingTempFreq && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="rounded-lg border p-6 max-w-md w-full space-y-4" style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)' }}>
              <h3 className="text-lg font-semibold" style={{ color: 'var(--foreground)' }}>Create Temporary Frequency</h3>

              <div>
                <label className="block text-sm font-medium mb-2" style={{ color: 'var(--muted-foreground)' }}>Frequency *</label>
                <input
                  type="text"
                  value={tempFreqForm.frequency}
                  onChange={(e) => setTempFreqForm({ ...tempFreqForm, frequency: e.target.value })}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2"
                  style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
                  placeholder="e.g., 70.0"
                  autoFocus
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-2" style={{ color: 'var(--muted-foreground)' }}>Type *</label>
                  <select
                    value={tempFreqForm.type}
                    onChange={(e) => setTempFreqForm({ ...tempFreqForm, type: e.target.value as 'SR' | 'LR' })}
                    className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2"
                    style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
                  >
                    <option value="SR">SR</option>
                    <option value="LR">LR</option>
                  </select>
                </div>

                <div className="flex items-end">
                  <label className="flex items-center gap-2 cursor-pointer w-full" style={{ color: 'var(--foreground)' }}>
                    <input
                      type="checkbox"
                      checked={tempFreqForm.isAdditional}
                      onChange={(e) => setTempFreqForm({ ...tempFreqForm, isAdditional: e.target.checked })}
                      className="w-4 h-4 rounded"
                    />
                    <span className="text-sm font-medium">Additional</span>
                  </label>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2" style={{ color: 'var(--muted-foreground)' }}>Channel</label>
                <input
                  type="text"
                  value={tempFreqForm.channel}
                  onChange={(e) => setTempFreqForm({ ...tempFreqForm, channel: e.target.value })}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2"
                  style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
                  placeholder="e.g., SR Channel 1"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2" style={{ color: 'var(--muted-foreground)' }}>Callsign</label>
                <input
                  type="text"
                  value={tempFreqForm.callsign}
                  onChange={(e) => setTempFreqForm({ ...tempFreqForm, callsign: e.target.value })}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2"
                  style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
                  placeholder="e.g., Command Net"
                />
              </div>

              <div className="flex gap-2 justify-end pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setIsAddingTempFreq(false);
                    setTempFreqForm({
                      frequency: '',
                      type: 'SR',
                      isAdditional: false,
                      channel: '',
                      callsign: '',
                    });
                  }}
                  className="px-4 py-2 rounded-md text-sm font-medium transition-colors"
                  style={{ backgroundColor: 'var(--secondary)', color: 'var(--foreground)' }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    addTempFrequency();
                    setIsAddingTempFreq(false);
                  }}
                  className="px-4 py-2 rounded-md text-sm font-medium transition-colors"
                  style={{ backgroundColor: '#16a34a', color: '#ffffff' }}
                >
                  Add
                </button>
              </div>
            </div>
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
