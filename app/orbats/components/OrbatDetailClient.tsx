'use client';

import { useState, useEffect } from 'react';
import { useToast } from '@/app/components/ui/ToastContainer';
import LoadingSpinner from '@/app/components/ui/LoadingSpinner';

type ClientSignup = {
  id: number;
  user: {
    id: number | null;
    username: string;
  } | null;
};

type ClientSubslot = {
  id: number;
  name: string;
  orderIndex: number;
  maxSignups: number;
  signups: ClientSignup[];
  radioFrequency?: {
    id: number;
    frequency: string;
    type: 'SR' | 'LR';
    isAdditional: boolean;
    channel?: string | null;
    callsign?: string | null;
  } | null;
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
  eventDate: string | null; // ISO string or null
  startTime?: string | null;
  endTime?: string | null;
  slots: ClientSlot[];
  frequencies?: any[];
  tempFrequencies?: any;
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

type OrbatDetailClientProps = {
  orbat: ClientOrbat;
};

type ApiSubslot = {
  id: number;
  name: string;
  orderIndex: number;
  maxSignups: number;
  signups: {
    id: number;
    user: {
      id: number | null;
      username: string;
    } | null;
  }[];
  radioFrequency?: {
    id: number;
    frequency: string;
    type: 'SR' | 'LR';
    isAdditional: boolean;
    channel?: string | null;
    callsign?: string | null;
  } | null;
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
        default: return 'var(--primary)';
      }
    case 'civilianRelationship':
      switch (value) {
        case 'Friendly': return '#22c55e'; // green
        case 'Neutral': return '#f59e0b'; // amber
        case 'Hostile': return '#ef4444'; // red
        default: return 'var(--primary)';
      }
    case 'airspace':
      switch (value) {
        case 'Friendly': return '#22c55e'; // green
        case 'Contested': return '#f59e0b'; // amber
        case 'Hostile': return '#ef4444'; // red
        default: return 'var(--primary)';
      }
    case 'rulesOfEngagement':
      switch (value) {
        case 'Hold Fire': return '#ef4444'; // red
        case 'Return Fire': return '#f59e0b'; // amber
        case 'PID': return '#84cc16'; // lime
        case 'Weapons Free': return '#22c55e'; // green
        default: return 'var(--primary)';
      }
    default:
      return 'var(--primary)';
  }
}

export default function OrbatDetailClient({ orbat: initialOrbat }: OrbatDetailClientProps) {
  const [orbat, setOrbat] = useState<ClientOrbat>(initialOrbat);
  const [loadingSubslotId, setLoadingSubslotId] = useState<number | null>(null);
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);
  const { showSuccess, showError } = useToast();

  const eventDate = orbat.eventDate ? new Date(orbat.eventDate) : null;
  const isPast = !!eventDate && eventDate < new Date();

  // Fetch current user ID on mount
  useEffect(() => {
    fetch('/api/user/current')
      .then((res) => res.json())
      .then((data) => {
        if (data.id) setCurrentUserId(data.id);
      })
      .catch(() => {
        // Ignore error - user might not be logged in
      });
  }, []);

  async function handleSignup(subslotId: number) {
    setLoadingSubslotId(subslotId);

    try {
      const res = await fetch(`/api/subslots/${subslotId}/signup`, {
        method: 'POST',
      });

      if (!res.ok) {
        let message = 'Failed to sign up.';
        try {
          const body: { error?: string } = await res.json();
          if (body.error) message = body.error;
        } catch {
          // ignore JSON parse error
        }
        showError(message);
        return;
      }

      const updated: ApiSubslot = await res.json();

      const mappedSubslot: ClientSubslot = {
        id: updated.id,
        name: updated.name,
        orderIndex: updated.orderIndex,
        maxSignups: updated.maxSignups,
        signups: updated.signups.map((s) => ({
          id: s.id,
          user: s.user
            ? {
                id: s.user.id,
                username: s.user.username,
              }
            : null,
        })),
      };

      setOrbat((prev) => ({
        ...prev,
        slots: prev.slots.map((slot) => ({
          ...slot,
          subslots: slot.subslots.map((sub) =>
            sub.id === mappedSubslot.id ? mappedSubslot : sub,
          ),
        })),
      }));
      
      showSuccess('Successfully signed up!');
    } catch {
      showError('Network error while signing up.');
    } finally {
      setLoadingSubslotId(null);
    }
  }
  async function handleUnsign(subslotId: number) {
    setLoadingSubslotId(subslotId);

    try {
      const res = await fetch(`/api/subslots/${subslotId}/signup`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        let message = 'Failed to remove signup.';
        try {
          const body: { error?: string } = await res.json();
          if (body.error) message = body.error;
        } catch {
          // ignore JSON parse error
        }
        showError(message);
        return;
      }

      const updated: ApiSubslot = await res.json();

      const mappedSubslot: ClientSubslot = {
        id: updated.id,
        name: updated.name,
        orderIndex: updated.orderIndex,
        maxSignups: updated.maxSignups,
        signups: updated.signups.map((s) => ({
          id: s.id,
          user: s.user
            ? {
                id: s.user.id,
                username: s.user.username,
              }
            : null,
        })),
      };

      setOrbat((prev) => ({
        ...prev,
        slots: prev.slots.map((slot) => ({
          ...slot,
          subslots: slot.subslots.map((sub) =>
            sub.id === mappedSubslot.id ? mappedSubslot : sub,
          ),
        })),
      }));
      
      showSuccess('Signup removed successfully');
    } catch {
      showError('Network error while removing signup.');
    } finally {
      setLoadingSubslotId(null);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="border rounded-lg overflow-hidden" style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)' }}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-0">
          {/* Left column: Title and Description */}
          <div className="p-6 sm:border-r" style={{ borderColor: 'var(--border)' }}>
            <h1 className="text-2xl sm:text-3xl font-bold pb-4 border-b" style={{ color: 'var(--foreground)', borderColor: 'var(--border)' }}>{orbat.name}</h1>

            {/* Description and Event Date */}
            {(orbat.description || eventDate) && (
              <div className="mt-4 space-y-3">
                {orbat.description && (
                  <p className="text-sm sm:text-base" style={{ color: 'var(--muted-foreground)' }}>
                    {orbat.description}
                  </p>
                )}
                {eventDate && (
                  <p className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
                    Event date:{' '}
                    {eventDate.toLocaleString('en-GB', {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Right column: Factions */}
          {(orbat.bluforCountry || orbat.opforCountry || orbat.indepCountry || 
            orbat.bluforRelationship || orbat.opforRelationship || orbat.indepRelationship) && (
            <div className="text-xs space-y-1 p-6 border-t sm:border-t-0" style={{ borderColor: 'var(--border)' }}>
              {orbat.bluforCountry && (
                <div>
                  <p className="font-semibold" style={{ color: 'var(--foreground)' }}>BLUFOR: {orbat.bluforCountry}</p>
                  {orbat.bluforRelationship && <p style={{ color: 'var(--muted-foreground)' }}>Support: {orbat.bluforRelationship}</p>}
                </div>
              )}
              {orbat.opforCountry && (
                <div>
                  <p className="font-semibold" style={{ color: 'var(--foreground)' }}>OPFOR: {orbat.opforCountry}</p>
                  {orbat.opforRelationship && <p style={{ color: 'var(--muted-foreground)' }}>Rel: {orbat.opforRelationship}</p>}
                </div>
              )}
              {orbat.indepCountry && (
                <div>
                  <p className="font-semibold" style={{ color: 'var(--foreground)' }}>Indep: {orbat.indepCountry}</p>
                  {orbat.indepRelationship && <p style={{ color: 'var(--muted-foreground)' }}>Rel: {orbat.indepRelationship}</p>}
                </div>
              )}
            </div>
          )}
        </div>


        {isPast && (
          <p className="text-xs font-semibold mt-2" style={{ color: '#f59e0b' }}>
            This operation is in the past. Signups are closed, existing
            participants are shown below.
          </p>
        )}
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

            <ul className="space-y-2">
              {slot.subslots.map((sub) => {
                const hasSignup = sub.signups.length > 0;
                const isFull = sub.signups.length >= sub.maxSignups;
                const userSignedUp = currentUserId !== null && sub.signups.some(s => s.user?.id === currentUserId);

                const showSignupButton = !isPast && !userSignedUp && !isFull;
                const showUnsignButton = !isPast && userSignedUp;

                return (
                  <li
                    key={sub.id}
                    className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1"
                  >
                    <div>
                      <div className="font-medium" style={{ color: 'var(--foreground)' }}>{sub.name}</div>

                      {/* Show participant names only if there are any */}
                      {hasSignup && (
                        <div className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
                          {sub.signups
                            .map((s) => s.user?.username ?? 'Unknown')
                            .join(', ')}
                        </div>
                      )}
                    </div>

                    {showSignupButton && (
                      <button
                        type="button"
                        onClick={() => handleSignup(sub.id)}
                        disabled={loadingSubslotId === sub.id}
                        className="mt-1 sm:mt-0 inline-flex items-center justify-center rounded-md border px-3 py-1 text-xs font-medium transition disabled:opacity-50 disabled:cursor-not-allowed"
                        style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }}
                      >
                        {loadingSubslotId === sub.id ? (
                          <span className="flex items-center gap-2">
                            <LoadingSpinner size="sm" />
                            Signing…
                          </span>
                        ) : (
                          'Sign up'
                        )}
                      </button>
                    )}

                    {showUnsignButton && (
                      <button
                        type="button"
                        onClick={() => handleUnsign(sub.id)}
                        disabled={loadingSubslotId === sub.id}
                        className="mt-1 sm:mt-0 inline-flex items-center justify-center rounded-md border px-3 py-1 text-xs font-medium transition disabled:opacity-50 disabled:cursor-not-allowed"
                        style={{ borderColor: '#dc2626', color: '#ef4444' }}
                      >
                        {loadingSubslotId === sub.id ? (
                          <span className="flex items-center gap-2">
                            <LoadingSpinner size="sm" />
                            Removing…
                          </span>
                        ) : (
                          'Remove'
                        )}
                      </button>
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
                  });
                });
              }

              // Sort by callsign
              allFreqs.sort((a, b) => (a.callsign || '').localeCompare(b.callsign || ''));

              return allFreqs.map((freq) => (
                <div
                  key={freq._id}
                  className="border-l-4 pl-3 py-1"
                  style={{ borderColor: 'var(--primary)', color: 'var(--foreground)' }}
                >
                  <div className="font-semibold text-sm">{freq.callsign}</div>
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
    </div>
  );
}
