'use client';

import { useState } from 'react';
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

type ClientSubslot = {
  id: number;
  name: string;
  orderIndex: number;
  maxSignups: number;
  signups: ClientSignup[];
};

type ClientSlot = {
  id: number;
  name: string;
  orderIndex: number;
  subslots: ClientSubslot[];
};

type ClientOrbat = {
  id: number;
  name: string;
  description: string | null;
  eventDate: string | null;
  startTime?: string | null;
  endTime?: string | null;
  slots: ClientSlot[];
  frequencies?: any[];
  tempFrequencies?: any;
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
  const { showSuccess, showError } = useToast();

  const eventDate = orbat.eventDate ? new Date(orbat.eventDate) : null;

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
      body: JSON.stringify({ targetSubslotId }),
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to move signup');
    }

    // Refresh the orbat data
    const refreshRes = await fetch(`/api/orbats/${orbat.id}/full`);
    if (refreshRes.ok) {
      const updatedOrbat = await refreshRes.json();
      setOrbat(updatedOrbat);
    }
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

      // Refresh the orbat data
      const refreshRes = await fetch(`/api/orbats/${orbat.id}/full`);
      if (refreshRes.ok) {
        const updatedOrbat = await refreshRes.json();
        setOrbat(updatedOrbat);
        showSuccess('Signup removed successfully');
      }
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
    if (!selectedSignup) return [];

    const available: Array<{
      id: number;
      name: string;
      slotName: string;
      currentSignups: number;
      maxSignups: number;
    }> = [];

    orbat.slots.forEach((slot) => {
      slot.subslots.forEach((subslot) => {
        if (subslot.id !== selectedSignup.currentSubslotId) {
          available.push({
            id: subslot.id,
            name: subslot.name,
            slotName: slot.name,
            currentSignups: subslot.signups.length,
            maxSignups: subslot.maxSignups,
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
                  <p className="text-xs mt-1" style={{ color: 'var(--muted-foreground)' }}>
                    Event date:{' '}
                    {eventDate.toLocaleString('en-GB', {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                  </p>
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

      {/* Slots grid */}
      <section className={`grid gap-4 md:gap-6 ${
        orbat.slots.length === 1 ? 'grid-cols-1' :
        orbat.slots.length === 2 ? 'grid-cols-1 md:grid-cols-2' :
        'grid-cols-1 md:grid-cols-2 xl:grid-cols-3'
      }`}>
        {orbat.slots.map((slot) => (
          <article
            key={slot.id}
            className="rounded-lg border p-4 flex flex-col gap-3"
            style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)' }}
          >
            <h2 className="text-lg font-semibold pb-2" style={{ color: 'var(--foreground)', borderBottom: '1px solid var(--border)' }}>
              {slot.name}
            </h2>

            <ul className="space-y-3">
              {slot.subslots.map((sub) => {
                const hasSignup = sub.signups.length > 0;
                const isFull = sub.signups.length >= sub.maxSignups;

                return (
                  <li key={sub.id} className="flex flex-col gap-2">
                    <div className="flex justify-between items-start">
                      <div className="font-medium" style={{ color: 'var(--foreground)' }}>{sub.name}</div>
                      <div className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
                        {sub.signups.length}/{sub.maxSignups}
                        {isFull && <span className="ml-1" style={{ color: '#f59e0b' }}>(Full)</span>}
                      </div>
                    </div>

                    {hasSignup ? (
                      <div className="space-y-1 pl-2" style={{ borderLeft: '2px solid var(--primary)' }}>
                        {sub.signups.map((signup) => {
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
                                    sub.id,
                                    sub.name,
                                    slot.name
                                  )
                                }
                                className="px-2 py-0.5 text-xs"
                                style={{ color: 'var(--primary)' }}
                                title="Move to another slot"
                              >
                                Move
                              </button>
                              <button
                                onClick={() => handleRemoveSignup(signup.id, sub.id, signup.user?.username || 'Unknown')}
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
        ))}
      </section>

      {/* Radio Frequencies and Extra Intel Section - at bottom */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Radio Frequencies Box */}
        {((orbat.frequencies && orbat.frequencies.length > 0) || (orbat.tempFrequencies && orbat.tempFrequencies.length > 0)) && (
          <div className="border rounded-lg p-4" style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)' }}>
            <h2 className="text-lg font-semibold mb-3" style={{ color: 'var(--foreground)' }}>Radio Frequencies</h2>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
              {/* Combine and sort frequencies by callsign */}
              {(() => {
                const allFreqs: any[] = [];
                
                // Add saved frequencies
                if (orbat.frequencies && orbat.frequencies.length > 0) {
                  orbat.frequencies.forEach((f: any) => {
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
                if (Array.isArray(orbat.tempFrequencies) && orbat.tempFrequencies.length > 0) {
                  orbat.tempFrequencies.forEach((f: any) => {
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

                // Sort by callsign
                allFreqs.sort((a, b) => (a.callsign || '').localeCompare(b.callsign || ''));

                return allFreqs.map((freq) => (
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
                ));
              })()}
            </div>
          </div>
        )}

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
