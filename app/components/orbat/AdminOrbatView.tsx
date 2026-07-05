'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import MoveSignupModal from '@/app/components/orbat/MoveSignupModal';
import ConfirmModal from '@/app/components/ui/ConfirmModal';
import { useToast } from '@/app/components/ui/ToastContainer';

type ClientSignup = {
  id: number;
  user: {
    id: number | null;
    username: string;
    rankAbbreviation?: string;
    rankName?: string;
  } | null;
};

type ClientSlot = {
  id: number;
  name: string;
  orderIndex: number;
  maxSignups: number;
  signups: ClientSignup[];
};

type ClientSquad = {
  id: number;
  name: string;
  orderIndex: number;
  slots: ClientSlot[];
};

type ClientFrequency = {
  id: number;
  orbatId: number;
  radioFrequencyId: number;
  radioFrequency: {
    id: number;
    frequency: string;
    type: string;
    isAdditional: boolean;
    channel?: string | null;
    callsign?: string | null;
    createdAt: Date;
  };
};

type ClientOrbat = {
  id: number;
  name: string;
  description: string | null;
  eventDate: string | null;
  startTime?: string | null;
  endTime?: string | null;
  squads?: ClientSquad[];
  frequencies?: ClientFrequency[];
  tempFrequencies?: unknown;
  // Faction fields
  bluforCountry?: string | null;
  bluforRelationship?: string | null;
  opforCountry?: string | null;
  opforRelationship?: string | null;
  indepCountry?: string | null;
  indepRelationship?: string | null;
  // Extra Intel fields
  iedThreat?: string | null;
  civilianRelationship?: string | null;
  rulesOfEngagement?: string | null;
  airspace?: string | null;
  inGameTimezone?: string | null;
  operationDay?: string | null;
};

// Helper function to render frequencies section
function renderFrequenciesSection(frequencies: ClientFrequency[] | undefined, tempFrequencies: unknown): ReactNode {
  interface TempFrequency {
    _id?: string;
    callsign?: string;
    frequency: string;
    type: string;
    isAdditional: boolean;
    channel?: string | null;
  }
  
  const allFreqs: Array<{ _id: string; callsign: string; frequency: string; type: string; isAdditional: boolean; channel?: string | null; isTemp: boolean }> = [];
  
  // Add saved frequencies
  if (frequencies && frequencies.length > 0) {
    frequencies.forEach((f: ClientFrequency) => {
      allFreqs.push({
        _id: `saved-${f.radioFrequencyId}`,
        callsign: f.radioFrequency?.callsign || 'N/A',
        frequency: f.radioFrequency?.frequency,
        type: f.radioFrequency?.type,
        isAdditional: f.radioFrequency?.isAdditional,
        channel: f.radioFrequency?.channel,
        isTemp: false,
      });
    });
  }
  
  // Add temporary frequencies
  if (Array.isArray(tempFrequencies) && tempFrequencies.length > 0) {
    (tempFrequencies as Array<TempFrequency>).forEach((f: TempFrequency) => {
      allFreqs.push({
        _id: `temp-${f._id || f.frequency}`,
        callsign: f.callsign || 'N/A',
        frequency: f.frequency,
        type: f.type,
        isAdditional: f.isAdditional,
        channel: f.channel,
        isTemp: true,
      });
    });
  }

  // If no frequencies, return null
  if (allFreqs.length === 0) {
    return null;
  }

  return (
    <div className="border rounded-lg p-4" style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)' }}>
      <h2 className="text-lg font-semibold mb-3" style={{ color: 'var(--foreground)' }}>Radio Frequencies</h2>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
        {allFreqs.map((freq) => (
          <div
            key={freq._id}
            className="border-l-4 pl-3 py-1"
            style={{ borderColor: freq.isTemp ? '#f59e0b' : 'var(--primary)', color: 'var(--foreground)' }}
          >
            <div className="font-semibold text-sm">
              {freq.callsign}
              {freq.isTemp && <span className="ml-2 text-xs font-normal" style={{ color: '#f59e0b' }}>(Temp)</span>}
            </div>
            <div className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
              {freq.frequency} · <span style={{ color: 'var(--primary)' }}>{freq.isAdditional ? 'A' : ''}{freq.type}</span>
              {freq.channel && ` · ${freq.channel}`}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

type AdminOrbatViewProps = {
  orbat: ClientOrbat;
};

// Helper function to get color based on field value
function getIntelColor(field: string, value: string): string {
  switch (field) {
    case 'iedThreat':
      switch (value) {
        case 'None': return '#22c55e'; // green
        case 'Low': return '#84cc16'; // lime
        case 'Medium': return '#f59e0b'; // amber
        case 'High': return '#ef4444'; // red
        case 'Very High': return '#dc2626'; // dark red
        default: return 'var(--muted-foreground)';
      }
    case 'civilianRelationship':
      switch (value) {
        case 'Friendly': return '#22c55e'; // green
        case 'Neutral': return '#f59e0b'; // amber
        case 'Hostile': return '#ef4444'; // red
        default: return 'var(--muted-foreground)';
      }
    case 'airspace':
      switch (value) {
        case 'Friendly': return '#22c55e'; // green
        case 'Contested': return '#f59e0b'; // amber
        case 'Hostile': return '#ef4444'; // red
        default: return 'var(--muted-foreground)';
      }
    case 'rulesOfEngagement':
      switch (value) {
        case 'Hold Fire': return '#ef4444'; // red
        case 'Return Fire': return '#f59e0b'; // amber
        case 'PID': return '#84cc16'; // lime
        case 'Weapons Free': return '#22c55e'; // green
        default: return 'var(--muted-foreground)';
      }
    default:
      return 'var(--muted-foreground)';
  }
}

// Helper function to get color for faction relationships
function getRelationshipColor(relationship: string): string {
  switch (relationship) {
    case 'Friendly': return '#22c55e'; // green
    case 'Neutral': return '#f59e0b'; // amber
    case 'Hostile': return '#ef4444'; // red
    default: return 'var(--muted-foreground)';
  }
}

export default function AdminOrbatView({ orbat: initialOrbat }: AdminOrbatViewProps) {
  const [orbat, setOrbat] = useState<ClientOrbat>(initialOrbat);
  const [isStreamConnected, setIsStreamConnected] = useState(false);
  const [moveModalOpen, setMoveModalOpen] = useState(false);
  const [selectedSignup, setSelectedSignup] = useState<{
    id: number;
    userName: string;
    currentSubslotId: number;
    currentSubslotName: string;
    currentSlotName: string;
  } | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<{ signupId: number; subslotId: number; userName: string } | null>(null);
  const [isRemoving, setIsRemoving] = useState(false);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { showSuccess, showError, showWarning } = useToast();

  const eventDate = orbat.eventDate ? new Date(orbat.eventDate) : null;

  const refreshOrbat = useCallback(async () => {
    try {
      const refreshRes = await fetch(`/api/orbats/${initialOrbat.id}/full`);
      if (!refreshRes.ok) {
        return;
      }

      const updatedOrbat = await refreshRes.json();
      setOrbat(updatedOrbat);
    } catch {
      // fallback interval may recover
    }
  }, [initialOrbat.id]);

  const queueRefresh = useCallback(() => {
    if (refreshTimerRef.current) {
      return;
    }

    refreshTimerRef.current = setTimeout(() => {
      refreshTimerRef.current = null;
      void refreshOrbat();
    }, 250);
  }, [refreshOrbat]);

  useEffect(() => {
    const source = new EventSource(`/api/orbats/${initialOrbat.id}/events`);

    source.onopen = () => {
      setIsStreamConnected(true);
    };

    source.onmessage = () => {
      setIsStreamConnected(true);
      queueRefresh();
    };

    source.onerror = () => {
      setIsStreamConnected(false);
    };

    return () => {
      source.close();
      setIsStreamConnected(false);
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
  }, [initialOrbat.id, queueRefresh]);

  useEffect(() => {
    if (isStreamConnected) {
      return;
    }

    const interval = setInterval(() => {
      void refreshOrbat();
    }, 30000);

    return () => clearInterval(interval);
  }, [isStreamConnected, refreshOrbat]);

  const handleMoveClick = (
    signupId: number,
    userName: string,
    subslotId: number,
    subslotName: string,
    slotName: string
  ) => {
    setSelectedSignup({
      id: signupId,
      userName,
      currentSubslotId: subslotId,
      currentSubslotName: subslotName,
      currentSlotName: slotName,
    });
    setMoveModalOpen(true);
  };

  const handleMove = async (signupId: number, targetSubslotId: number) => {
    const res = await fetch(`/api/signups/${signupId}/move`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ targetSlotId: targetSubslotId }),
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to move signup');
    }

    const data = await res.json();

    // Show warnings if any
    if (data.warnings && Array.isArray(data.warnings)) {
      for (const warning of data.warnings) {
        showWarning(warning, 8000);
      }
    }

    await refreshOrbat();
  };

  const handleRemoveSignup = async (signupId: number, subslotId: number, userName: string) => {
    setConfirmRemove({ signupId, subslotId, userName });
  };

  const confirmRemoveSignup = async () => {
    if (!confirmRemove) return;
    
    setIsRemoving(true);
    const { signupId, subslotId } = confirmRemove;

    try {
      const res = await fetch(`/api/subslots/${subslotId}/signup`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ signupId }),
      });

      if (!res.ok) {
        showError('Failed to remove signup');
        return;
      }

      await refreshOrbat();
      showSuccess('Signup removed successfully');
    } catch (error) {
      console.error('Error removing signup:', error);
      showError('Error removing signup');
    } finally {
      setIsRemoving(false);
      setConfirmRemove(null);
    }
  };

  // Get all available subslots for moving (excluding the current one)
  const getAvailableSubslots = () => {
    if (!selectedSignup || !orbat.squads) return [];

    const available: Array<{
      id: number;
      name: string;
      slotName: string;
      currentSignups: number;
      maxSignups: number;
    }> = [];

    orbat.squads.forEach((squad) => {
      squad.slots.forEach((slot) => {
        if (slot.id !== selectedSignup.currentSubslotId) {
          available.push({
            id: slot.id,
            name: slot.name,
            slotName: `${squad.name} - ${slot.name}`,
            currentSignups: slot.signups.length,
            maxSignups: slot.maxSignups,
          });
        }
      });
    });

    return available;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="border rounded-lg p-6" style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)' }}>
        <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
          <div className="flex-1">
            <div className="flex items-start gap-3">
              <div className="flex-1">
                <h1 className="text-2xl sm:text-3xl font-bold" style={{ color: 'var(--foreground)' }}>{orbat.name}</h1>
                {orbat.description && (
                  <p className="text-sm sm:text-base mt-2" style={{ color: 'var(--muted-foreground)' }}>
                    {orbat.description}
                  </p>
                )}
                {eventDate && (
                  <div className="text-xs mt-1" style={{ color: 'var(--muted-foreground)' }}>
                    <p>Event date: {eventDate.toLocaleDateString('en-GB', { dateStyle: 'medium' })}</p>
                    {(orbat.startTime || orbat.endTime) && (
                      <p>
                        Time: {orbat.startTime || '??:??'}{orbat.endTime ? ` - ${orbat.endTime}` : ''}
                      </p>
                    )}
                  </div>
                )}
              </div>
              <span className="px-3 py-1 text-xs font-medium rounded-full whitespace-nowrap" style={{ backgroundColor: '#9333ea', color: '#ffffff' }}>
                Admin View
              </span>
            </div>
          </div>

          {/* Factions */}
          {(orbat.bluforCountry || orbat.opforCountry || orbat.indepCountry || 
            orbat.bluforRelationship || orbat.opforRelationship || orbat.indepRelationship) && (
            <div className="text-xs space-y-1 p-4 border-l" style={{ borderColor: 'var(--border)' }}>
              {orbat.bluforCountry && (
                <div>
                  <p className="font-semibold" style={{ color: 'var(--foreground)' }}>BLUFOR: {orbat.bluforCountry}</p>
                  {orbat.bluforRelationship && <p style={{ color: getRelationshipColor(orbat.bluforRelationship) }}>Support: {orbat.bluforRelationship}</p>}
                </div>
              )}
              {orbat.opforCountry && (
                <div>
                  <p className="font-semibold" style={{ color: 'var(--foreground)' }}>OPFOR: {orbat.opforCountry}</p>
                  {orbat.opforRelationship && <p style={{ color: getRelationshipColor(orbat.opforRelationship) }}>Rel: {orbat.opforRelationship}</p>}
                </div>
              )}
              {orbat.indepCountry && (
                <div>
                  <p className="font-semibold" style={{ color: 'var(--foreground)' }}>Indep: {orbat.indepCountry}</p>
                  {orbat.indepRelationship && <p style={{ color: getRelationshipColor(orbat.indepRelationship) }}>Rel: {orbat.indepRelationship}</p>}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Squads grid */}
      <section className={`grid gap-4 md:gap-6 ${
        !orbat.squads || orbat.squads.length === 0 ? 'grid-cols-1' :
        orbat.squads.length === 1 ? 'grid-cols-1' :
        orbat.squads.length === 2 ? 'grid-cols-1 md:grid-cols-2' :
        'grid-cols-1 md:grid-cols-2 xl:grid-cols-3'
      }`}>
        {!orbat.squads || orbat.squads.length === 0 ? (
          <div className="col-span-full text-center py-8" style={{ color: 'var(--muted-foreground)' }}>
            No squads found
          </div>
        ) : (
          orbat.squads.map((squad) => (
          <article
            key={squad.id}
            className="rounded-lg border p-4 flex flex-col gap-3"
            style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)' }}
          >
            <h2 className="text-lg font-semibold pb-2" style={{ color: 'var(--foreground)', borderBottom: '1px solid var(--border)' }}>
              {squad.name}
            </h2>

            <ul className="space-y-3">
              {squad.slots.map((slot) => {
                const hasSignup = slot.signups.length > 0;
                const isFull = slot.signups.length >= slot.maxSignups;

                return (
                  <li key={slot.id} className="flex flex-col gap-2">
                    <div className="flex justify-between items-start">
                      <div className="font-medium" style={{ color: 'var(--foreground)' }}>{slot.name}</div>
                      <div className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
                        {slot.signups.length}/{slot.maxSignups}
                        {isFull && <span className="ml-1" style={{ color: '#f59e0b' }}>(Full)</span>}
                      </div>
                    </div>

                    {hasSignup ? (
                      <div className="space-y-1 pl-2" style={{ borderLeft: '2px solid var(--primary)' }}>
                        {slot.signups.map((signup) => {
                          const username = signup.user?.username ?? 'Unknown';
                          const rankAbbr = signup.user?.rankAbbreviation;
                          const displayName = rankAbbr ? `[${rankAbbr}] ${username}` : username;
                          return (
                          <div
                            key={signup.id}
                            className="flex justify-between items-center text-sm rounded px-2 py-1"
                            style={{ backgroundColor: 'var(--background)' }}
                          >
                            <span style={{ color: 'var(--foreground)' }}>
                              {displayName}
                            </span>
                            <div className="flex gap-1">
                              <button
                                onClick={() =>
                                  handleMoveClick(
                                    signup.id,
                                    signup.user?.username ?? 'Unknown',
                                    slot.id,
                                    slot.name,
                                    squad.name
                                  )
                                }
                                className="px-2 py-0.5 text-xs"
                                style={{ color: 'var(--primary)' }}
                                title="Move to another slot"
                              >
                                Move
                              </button>
                              <button
                                onClick={() => handleRemoveSignup(signup.id, slot.id, signup.user?.username || 'Unknown')}
                                className="px-2 py-0.5 text-xs"
                                style={{ color: '#ef4444' }}
                                title="Remove signup"
                              >
                                Remove
                              </button>
                            </div>
                          </div>
                        );
                        })}
                      </div>
                    ) : (
                      <div className="text-xs italic pl-2" style={{ color: 'var(--muted-foreground)' }}>Empty</div>
                    )}
                  </li>
                );
              })}
            </ul>
          </article>
        )))}
      </section>

      {/* Radio Frequencies and Extra Intel Section - at bottom */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Radio Frequencies Box */}
        {renderFrequenciesSection(orbat.frequencies, orbat.tempFrequencies)}

        {/* Extra Intel Box */}
        {(orbat.iedThreat || orbat.civilianRelationship || orbat.rulesOfEngagement || orbat.airspace || orbat.inGameTimezone || orbat.operationDay) && (
          <div className="border rounded-lg p-4" style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)' }}>
            <h2 className="text-lg font-semibold mb-3" style={{ color: 'var(--foreground)' }}>Extra Intel</h2>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
              {orbat.iedThreat && (
                <div className="border-l-4 pl-3 py-1" style={{ borderColor: getIntelColor('iedThreat', orbat.iedThreat) }}>
                  <div className="text-xs" style={{ color: 'var(--muted-foreground)' }}>IED/Trap/Mine Threat</div>
                  <div className="font-semibold text-sm" style={{ color: getIntelColor('iedThreat', orbat.iedThreat) }}>{orbat.iedThreat}</div>
                </div>
              )}
              {orbat.civilianRelationship && (
                <div className="border-l-4 pl-3 py-1" style={{ borderColor: getIntelColor('civilianRelationship', orbat.civilianRelationship) }}>
                  <div className="text-xs" style={{ color: 'var(--muted-foreground)' }}>Civilian Relationship</div>
                  <div className="font-semibold text-sm" style={{ color: getIntelColor('civilianRelationship', orbat.civilianRelationship) }}>{orbat.civilianRelationship}</div>
                </div>
              )}
              {orbat.rulesOfEngagement && (
                <div className="border-l-4 pl-3 py-1" style={{ borderColor: getIntelColor('rulesOfEngagement', orbat.rulesOfEngagement) }}>
                  <div className="text-xs" style={{ color: 'var(--muted-foreground)' }}>Rules of Engagement</div>
                  <div className="font-semibold text-sm" style={{ color: getIntelColor('rulesOfEngagement', orbat.rulesOfEngagement) }}>{orbat.rulesOfEngagement}</div>
                </div>
              )}
              {orbat.airspace && (
                <div className="border-l-4 pl-3 py-1" style={{ borderColor: getIntelColor('airspace', orbat.airspace) }}>
                  <div className="text-xs" style={{ color: 'var(--muted-foreground)' }}>Airspace</div>
                  <div className="font-semibold text-sm" style={{ color: getIntelColor('airspace', orbat.airspace) }}>{orbat.airspace}</div>
                </div>
              )}
              {orbat.inGameTimezone && (
                <div className="border-l-4 pl-3 py-1" style={{ borderColor: 'var(--primary)' }}>
                  <div className="text-xs" style={{ color: 'var(--muted-foreground)' }}>In Game Timezone</div>
                  <div className="font-semibold text-sm" style={{ color: 'var(--foreground)' }}>{orbat.inGameTimezone}</div>
                </div>
              )}
              {orbat.operationDay && (
                <div className="border-l-4 pl-3 py-1" style={{ borderColor: 'var(--primary)' }}>
                  <div className="text-xs" style={{ color: 'var(--muted-foreground)' }}>Operation Day</div>
                  <div className="font-semibold text-sm" style={{ color: 'var(--foreground)' }}>{orbat.operationDay}</div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Move Modal */}
      {selectedSignup && (
        <MoveSignupModal
          isOpen={moveModalOpen}
          onClose={() => {
            setMoveModalOpen(false);
            setSelectedSignup(null);
          }}
          signupId={selectedSignup.id}
          userName={selectedSignup.userName}
          currentSubslotName={`${selectedSignup.currentSlotName} - ${selectedSignup.currentSubslotName}`}
          availableSubslots={getAvailableSubslots()}
          onMove={handleMove}
        />
      )}

      {/* Confirm Remove Signup Modal */}
      <ConfirmModal
        isOpen={confirmRemove !== null}
        title="Remove Signup"
        message={`Are you sure you want to remove ${confirmRemove?.userName || 'this user'} from this position?`}
        confirmLabel="Remove"
        cancelLabel="Cancel"
        onConfirm={confirmRemoveSignup}
        onCancel={() => setConfirmRemove(null)}
        isDestructive={true}
        isLoading={isRemoving}
      />
    </div>
  );
}
