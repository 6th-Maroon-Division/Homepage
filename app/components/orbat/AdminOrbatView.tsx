'use client';

import { useState } from 'react';
import MoveSignupModal from '@/app/components/orbat/MoveSignupModal';

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
  slots: ClientSlot[];
};

type AdminOrbatViewProps = {
  orbat: ClientOrbat;
};

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

  const handleRemoveSignup = async (signupId: number, subslotId: number) => {
    if (!confirm('Are you sure you want to remove this signup?')) {
      return;
    }

    try {
      const res = await fetch(`/api/subslots/${subslotId}/signup`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ signupId }),
      });

      if (!res.ok) {
        alert('Failed to remove signup');
        return;
      }

      // Refresh the orbat data
      const refreshRes = await fetch(`/api/orbats/${orbat.id}/full`);
      if (refreshRes.ok) {
        const updatedOrbat = await refreshRes.json();
        setOrbat(updatedOrbat);
      }
    } catch (error) {
      console.error('Error removing signup:', error);
      alert('Error removing signup');
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
      <header className="space-y-2">
        <div className="flex justify-between items-start">
          <div>
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
          <span className="px-3 py-1 text-xs font-medium rounded-full" style={{ backgroundColor: '#9333ea', color: '#ffffff' }}>
            Admin View
          </span>
        </div>
      </header>

      {/* Slots grid */}
      <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 md:gap-6">
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
                        {sub.signups.map((signup) => (
                          <div
                            key={signup.id}
                            className="flex justify-between items-center text-sm rounded px-2 py-1"
                            style={{ backgroundColor: 'var(--background)' }}
                          >
                            <span style={{ color: 'var(--foreground)' }}>
                              {signup.user?.username ?? 'Unknown'}
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
                                onClick={() => handleRemoveSignup(signup.id, sub.id)}
                                className="px-2 py-0.5 text-xs"
                                style={{ color: '#ef4444' }}
                                title="Remove signup"
                              >
                                Remove
                              </button>
                            </div>
                          </div>
                        ))}
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
    </div>
  );
}
