'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '../ui/ToastContainer';
import LoadingSpinner from '../ui/LoadingSpinner';

const logClientError = (...args: unknown[]) => {
  if (process.env.NODE_ENV === 'development') {
    console.error(...args);
  }
};

type Subslot = {
  id?: number;
  squadRoleId?: number | null;
  name: string;
  orderIndex: number;
  maxSignups: number;
  requiredTrainingIds?: number[];
  requiredRankIds?: number[];
  requiredTrainingId?: number | null;
  requiredRankId?: number | null;
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
  const [subslotSearchBySlot, setSubslotSearchBySlot] = useState<Record<number, string>>({});
  const [selectedDefinitionBySlot, setSelectedDefinitionBySlot] = useState<Record<number, string>>({});
  const [draggedRole, setDraggedRole] = useState<{ slotIndex: number; subslotIndex: number } | null>(null);
  const draggedRoleRef = useRef<{ slotIndex: number; subslotIndex: number } | null>(null);
  const [dragOverTarget, setDragOverTarget] = useState<{ slotIndex: number; subslotIndex: number | null } | null>(null);
  const [draggedSquadIndex, setDraggedSquadIndex] = useState<number | null>(null);
  const [dragOverSquadIndex, setDragOverSquadIndex] = useState<number | null>(null);
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
        logClientError('Error fetching templates:', error);
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
        logClientError('Error fetching recent orbats:', error);
      }
    };

    const fetchSubslotDefinitions = async () => {
      try {
        const response = await fetch('/api/subslot-definitions');
        if (response.ok) {
          const data = await response.json();
          setSubslotDefinitions(data);
        }
      } catch (error) {
        logClientError('Error fetching role definitions:', error);
      }
    };

    Promise.all([fetchTemplates(), fetchRecentOrbats(), fetchSubslotDefinitions()]).finally(() => {
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
        
        // Handle slots - templates use slotsJson as squads with nested slots, orbats use squads
        let slots = null;
        if (data.slotsJson) {
          const parsedSlotsJson = typeof data.slotsJson === 'string' ? JSON.parse(data.slotsJson) : data.slotsJson;
          slots = (parsedSlotsJson as any[]).map((squad: any) => ({
            id: squad.id,
            name: squad.name,
            orderIndex: squad.orderIndex,
            subslots: (squad.slots || []).map((slot: any) => ({
              id: slot.id,
              squadRoleId: slot.squadRoleId ?? null,
              name: slot.name,
              orderIndex: slot.orderIndex,
              maxSignups: slot.maxSignups ?? 1,
            })),
          }));
        } else if (data.squads) {
          slots = data.squads.map((squad: any) => ({
            id: squad.id,
            name: squad.name,
            orderIndex: squad.orderIndex,
            subslots: (squad.slots || []).map((slot: any) => ({
              id: slot.id,
              squadRoleId: slot.squadRoleId ?? null,
              name: slot.name,
              orderIndex: slot.orderIndex,
              maxSignups: slot.maxSignups ?? 1,
            })),
          }));
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
      logClientError('Error loading template:', error);
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
                const parsedSlotsJson = typeof template.slotsJson === 'string'
                  ? JSON.parse(template.slotsJson)
                  : template.slotsJson;
                const mappedSlots = (parsedSlotsJson as any[]).map((squad: any) => ({
                  id: squad.id,
                  name: squad.name,
                  orderIndex: squad.orderIndex,
                  subslots: (squad.slots || []).map((slot: any) => ({
                    id: slot.id,
                    squadRoleId: slot.squadRoleId ?? null,
                    name: slot.name,
                    orderIndex: slot.orderIndex,
                    maxSignups: slot.maxSignups ?? 1,
                  })),
                }));
                setSlots(mappedSlots);
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
            logClientError('Error loading template:', error);
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
        logClientError('Error fetching radio frequencies:', error);
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
          logClientError('Error fetching orbat frequencies:', error);
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

  const normalizeOrderIndexes = (inputSlots: Slot[]) => {
    let slotOrder = 0;
    return inputSlots.map((slot) => {
      if (slot._deleted) {
        return slot;
      }

      let roleOrder = 0;
      const normalizedSubslots = slot.subslots.map((subslot) => {
        if (subslot._deleted) {
          return subslot;
        }

        return {
          ...subslot,
          orderIndex: roleOrder++,
        };
      });

      return {
        ...slot,
        orderIndex: slotOrder++,
        subslots: normalizedSubslots,
      };
    });
  };

  const updateSlot = (slotIndex: number, field: keyof Slot, value: string) => {
    const newSlots = [...slots];
    (newSlots[slotIndex] as Record<string, unknown>)[field] = value;
    setSlots(newSlots);
  };

  const updateSubslotMaxSignups = (slotIndex: number, subslotIndex: number, value: number) => {
    const newSlots = [...slots];
    const safeValue = Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1;
    newSlots[slotIndex].subslots[subslotIndex].maxSignups = safeValue;
    setSlots(newSlots);
  };

  const moveSquadByDrag = (fromSlotIndex: number, toSlotIndex: number | null) => {
    if (toSlotIndex === null) {
      return;
    }

    if (fromSlotIndex === toSlotIndex) {
      return;
    }

    const nextSlots = [...slots];
    const [movingSlot] = nextSlots.splice(fromSlotIndex, 1);

    if (!movingSlot) {
      return;
    }

    let insertIndex = toSlotIndex;
    if (fromSlotIndex < toSlotIndex) {
      insertIndex -= 1;
    }

    nextSlots.splice(Math.max(0, insertIndex), 0, movingSlot);
    setSlots(normalizeOrderIndexes(nextSlots));
  };

  const handleSquadDragStart = (slotIndex: number) => {
    setDraggedSquadIndex(slotIndex);
  };

  const handleSquadDragEnd = () => {
    setDraggedSquadIndex(null);
    setDragOverSquadIndex(null);
  };

  const handleSquadDrop = (slotIndex: number | null) => {
    if (draggedSquadIndex === null) {
      return;
    }

    moveSquadByDrag(draggedSquadIndex, slotIndex);
    handleSquadDragEnd();
  };

  const moveSubslotByDrag = (
    fromSlotIndex: number,
    fromSubslotIndex: number,
    toSlotIndex: number,
    toSubslotIndex: number | null
  ) => {
    const newSlots = [...slots];
    const fromSubslots = [...newSlots[fromSlotIndex].subslots];
    const [movedSubslot] = fromSubslots.splice(fromSubslotIndex, 1);

    if (!movedSubslot) return;

    newSlots[fromSlotIndex] = {
      ...newSlots[fromSlotIndex],
      subslots: fromSubslots,
    };

    const toSubslots = [...newSlots[toSlotIndex].subslots];

    if (toSubslotIndex === null || toSubslotIndex >= toSubslots.length) {
      toSubslots.push(movedSubslot);
    } else {
      let adjustedTargetIndex = toSubslotIndex;
      if (fromSlotIndex === toSlotIndex && fromSubslotIndex < toSubslotIndex) {
        adjustedTargetIndex -= 1;
      }
      toSubslots.splice(Math.max(0, adjustedTargetIndex), 0, movedSubslot);
    }

    newSlots[toSlotIndex] = {
      ...newSlots[toSlotIndex],
      subslots: toSubslots,
    };

    setSlots(normalizeOrderIndexes(newSlots));
  };

  const handleRoleDragStart = (slotIndex: number, subslotIndex: number) => {
    const nextDraggedRole = { slotIndex, subslotIndex };
    draggedRoleRef.current = nextDraggedRole;
    setDraggedRole(nextDraggedRole);
  };

  const handleRoleDragEnd = () => {
    draggedRoleRef.current = null;
    setDraggedRole(null);
    setDragOverTarget(null);
  };

  const handleRoleDrop = (slotIndex: number, subslotIndex: number | null) => {
    const activeDraggedRole = draggedRoleRef.current ?? draggedRole;
    if (!activeDraggedRole) return;

    if (
      activeDraggedRole.slotIndex === slotIndex &&
      subslotIndex !== null &&
      activeDraggedRole.subslotIndex === subslotIndex
    ) {
      handleRoleDragEnd();
      return;
    }

    moveSubslotByDrag(
      activeDraggedRole.slotIndex,
      activeDraggedRole.subslotIndex,
      slotIndex,
      subslotIndex
    );

    handleRoleDragEnd();
  };

  const addSubslotFromDefinition = (slotIndex: number, definitionId: number) => {
    const definition = subslotDefinitions.find((item) => item.id === definitionId);
    if (!definition) {
      showError('Selected role definition was not found');
      return;
    }

    const newSlots = [...slots];
    const activeSubslots = newSlots[slotIndex].subslots.filter((s) => !s._deleted);

    const alreadyAdded = activeSubslots.some((subslot) => subslot.squadRoleId === definition.id);
    if (alreadyAdded) {
      showError('This role is already added to the slot');
      return;
    }

    const newOrderIndex = activeSubslots.length;
    newSlots[slotIndex].subslots.push({
      squadRoleId: definition.id,
      name: definition.name,
      orderIndex: newOrderIndex,
      maxSignups: definition.maxSignups,
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
    });
    setSlots(normalizeOrderIndexes(newSlots));

    setSelectedDefinitionBySlot((prev) => ({ ...prev, [slotIndex]: '' }));
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
    setSlots(normalizeOrderIndexes(newSlots));
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
        setError(`Slot "${slot.name}" must have at least one role`);
        setIsSaving(false);
        return;
      }
      for (const subslot of activeSubslots) {
        if (!subslot.name.trim()) {
          setError('All roles must have a name');
          setIsSaving(false);
          return;
        }

        if (!Number.isInteger(subslot.maxSignups) || subslot.maxSignups < 1) {
          setError('Max signups must be at least 1 for each role');
          setIsSaving(false);
          return;
        }
      }
    }

    try {
      // Clean up slots/squads for API: remove _deleted flags and filter out deleted items
      const cleanSquads = slots
        .filter((s) => !s._deleted)
        .map((slot) => ({
          name: slot.name,
          orderIndex: slot.orderIndex,
          slots: slot.subslots
            .filter((sub) => !sub._deleted)
            .map((subslot) => ({
              squadRoleId: subslot.squadRoleId ?? null,
              name: subslot.name,
              orderIndex: subslot.orderIndex,
              maxSignups: subslot.maxSignups,
            })),
        }));

      const payload = {
        name,
        description,
        eventDate: eventDate || null,
        startTime: startTime || null,
        endTime: endTime || null,
        squads: cleanSquads,
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
      logClientError('Error saving OrbAT:', err);
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
            ? 'Set up a new operation with slots and roles' 
            : 'Modify operation details, slots, and roles'}
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
          <h2 className="text-xl font-semibold" style={{ color: 'var(--foreground)' }}>Slots & Roles</h2>
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
                <div
                  key={slotIndex}
                  draggable={draggedRole === null}
                  onDragStart={() => {
                    if (draggedRole) return;
                    handleSquadDragStart(slotIndex);
                  }}
                  onDragEnd={handleSquadDragEnd}
                  onDragOver={(e) => {
                    if (draggedSquadIndex === null) return;
                    e.preventDefault();
                  }}
                  onDragEnter={() => {
                    if (draggedSquadIndex === null) return;
                    setDragOverSquadIndex(slotIndex);
                  }}
                  onDrop={(e) => {
                    if (draggedSquadIndex === null) return;
                    e.preventDefault();
                    handleSquadDrop(slotIndex);
                  }}
                  className="border rounded-lg p-4 space-y-3 flex flex-col"
                  style={{
                    backgroundColor: 'var(--background)',
                    borderColor: dragOverSquadIndex === slotIndex ? 'var(--primary)' : 'var(--border)',
                    opacity: draggedSquadIndex === slotIndex ? 0.6 : 1,
                  }}
                >
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
                      <h4 className="text-sm font-medium" style={{ color: 'var(--muted-foreground)' }}>Roles</h4>
                    </div>

                    <div className="space-y-2 rounded-md border p-3" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--secondary)' }}>
                      <label className="block text-xs font-medium" style={{ color: 'var(--muted-foreground)' }}>
                        Search role by name
                      </label>
                      <input
                        type="text"
                        value={subslotSearchBySlot[slotIndex] || ''}
                        onChange={(e) =>
                          setSubslotSearchBySlot((prev) => ({ ...prev, [slotIndex]: e.target.value }))
                        }
                        className="w-full px-3 py-2 border rounded-md text-sm focus:outline-none focus:ring-2"
                        style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
                        placeholder="Type to filter roles..."
                      />

                      <div className="flex gap-2">
                        <select
                          value={selectedDefinitionBySlot[slotIndex] || ''}
                          onChange={(e) =>
                            setSelectedDefinitionBySlot((prev) => ({ ...prev, [slotIndex]: e.target.value }))
                          }
                          className="w-full px-3 py-2 border rounded-md text-sm focus:outline-none focus:ring-2"
                          style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
                        >
                          <option value="">Select role...</option>
                          {subslotDefinitions
                            .filter((definition) => {
                              // Filter out retired roles
                              if (definition.isRetired) return false;
                              const searchTerm = (subslotSearchBySlot[slotIndex] || '').trim().toLowerCase();
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
                          type="button"
                          onClick={() => {
                            const value = selectedDefinitionBySlot[slotIndex];
                            if (!value) return;
                            addSubslotFromDefinition(slotIndex, Number(value));
                          }}
                          disabled={!selectedDefinitionBySlot[slotIndex]}
                          className="px-3 py-2 rounded text-xs font-medium disabled:opacity-50"
                          style={{ backgroundColor: 'var(--primary)', color: 'var(--primary-foreground)' }}
                        >
                          Add
                        </button>
                      </div>
                    </div>

                    {slot.subslots.filter((s) => !s._deleted).length === 0 ? (
                      <div
                        className="text-sm py-2 rounded-md border border-dashed px-2"
                        style={{
                          color: 'var(--muted-foreground)',
                          borderColor:
                            dragOverTarget?.slotIndex === slotIndex && dragOverTarget?.subslotIndex === null
                              ? 'var(--primary)'
                              : 'var(--border)',
                        }}
                        onDragOver={(e) => {
                          if (!draggedRoleRef.current) return;
                          e.preventDefault();
                        }}
                        onDragEnter={() => {
                          if (!draggedRoleRef.current) return;
                          setDragOverTarget({ slotIndex, subslotIndex: null });
                        }}
                        onDrop={(e) => {
                          if (!draggedRoleRef.current) return;
                          e.preventDefault();
                          handleRoleDrop(slotIndex, null);
                        }}
                      >
                        No roles
                      </div>
                    ) : (
                      <>
                        {slot.subslots.map((subslot, subslotIndex) =>
                          subslot._deleted ? null : (
                          <div
                            key={subslotIndex}
                            draggable
                            onDragStart={(e) => {
                              e.stopPropagation();
                              handleRoleDragStart(slotIndex, subslotIndex);
                            }}
                            onDragEnd={(e) => {
                              e.stopPropagation();
                              handleRoleDragEnd();
                            }}
                            onDragOver={(e) => {
                              if (!draggedRoleRef.current) return;
                              e.preventDefault();
                            }}
                            onDragEnter={() => {
                              if (!draggedRoleRef.current) return;
                              setDragOverTarget({ slotIndex, subslotIndex });
                            }}
                            onDrop={(e) => {
                              if (!draggedRoleRef.current) return;
                              e.preventDefault();
                              handleRoleDrop(slotIndex, subslotIndex);
                            }}
                            className="border border-gray-600 rounded p-2 space-y-2 cursor-move"
                            style={{
                              backgroundColor: 'var(--background)',
                              borderColor:
                                dragOverTarget?.slotIndex === slotIndex && dragOverTarget?.subslotIndex === subslotIndex
                                  ? 'var(--primary)'
                                  : 'var(--border)',
                              opacity:
                                draggedRole?.slotIndex === slotIndex && draggedRole?.subslotIndex === subslotIndex
                                  ? 0.6
                                  : 1,
                            }}
                          >
                            <div className="flex gap-2 items-start">
                              <div className="flex-1 text-sm" style={{ color: 'var(--foreground)' }}>
                                <div className="font-medium">{subslot.name}</div>
                                <div className="mt-2 flex items-center gap-2">
                                  <label className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
                                    Max signups
                                  </label>
                                  <input
                                    type="number"
                                    min={1}
                                    value={subslot.maxSignups}
                                    onChange={(e) =>
                                      updateSubslotMaxSignups(
                                        slotIndex,
                                        subslotIndex,
                                        Number(e.target.value || 1)
                                      )
                                    }
                                    className="w-20 px-2 py-1 border rounded text-xs"
                                    style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
                                  />
                                </div>
                                {((subslot.requiredTrainingIds && subslot.requiredTrainingIds.length > 0) ||
                                  (subslot.requiredRankIds && subslot.requiredRankIds.length > 0) ||
                                  subslot.requiredTrainingId ||
                                  subslot.requiredRankId) && (
                                  <div className="text-xs mt-1" style={{ color: 'var(--muted-foreground)' }}>
                                    Prerequisites configured on role definition
                                  </div>
                                )}
                              </div>
                              <button
                                type="button"
                                onClick={() => removeSubslot(slotIndex, subslotIndex)}
                                className="px-3 py-2 text-sm"
                                style={{ color: '#ef4444' }}
                                title="Remove role"
                              >
                                ×
                              </button>
                            </div>
                          </div>
                          )
                        )}

                        <div
                          className="rounded-md border border-dashed px-2 py-2 text-xs"
                          style={{
                            color: 'var(--muted-foreground)',
                            borderColor:
                              dragOverTarget?.slotIndex === slotIndex && dragOverTarget?.subslotIndex === null
                                ? 'var(--primary)'
                                : 'var(--border)',
                          }}
                          onDragOver={(e) => {
                            if (!draggedRoleRef.current) return;
                            e.preventDefault();
                          }}
                          onDragEnter={() => {
                            if (!draggedRoleRef.current) return;
                            setDragOverTarget({ slotIndex, subslotIndex: null });
                          }}
                          onDrop={(e) => {
                            if (!draggedRoleRef.current) return;
                            e.preventDefault();
                            handleRoleDrop(slotIndex, null);
                          }}
                        >
                          Drag here to move role to end of this squad
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )
            )}

            <div
              className="rounded-lg border border-dashed px-3 py-6 text-sm"
              style={{
                color: 'var(--muted-foreground)',
                borderColor: dragOverSquadIndex === slots.length ? 'var(--primary)' : 'var(--border)',
              }}
              onDragOver={(e) => {
                if (draggedSquadIndex === null) return;
                e.preventDefault();
              }}
              onDragEnter={() => {
                if (draggedSquadIndex === null) return;
                setDragOverSquadIndex(slots.length);
              }}
              onDrop={(e) => {
                if (draggedSquadIndex === null) return;
                e.preventDefault();
                handleSquadDrop(slots.length);
              }}
            >
              Drag here to move squad to end
            </div>
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
