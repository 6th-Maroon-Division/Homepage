'use client';

import { useState, useEffect } from 'react';
import { useToast } from '@/app/components/ToastContainer';
import LoadingSpinner from '@/app/components/LoadingSpinner';

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
  eventDate: string | null; // ISO string or null
  slots: ClientSlot[];
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
};

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
      <header className="space-y-2">
        <h1 className="text-2xl sm:text-3xl font-bold">{orbat.name}</h1>

        {orbat.description && (
          <p className="text-sm sm:text-base text-gray-300">
            {orbat.description}
          </p>
        )}

        {eventDate && (
          <p className="text-xs text-gray-400">
            Event date:{' '}
            {eventDate.toLocaleString('en-GB', {
              dateStyle: 'medium',
              timeStyle: 'short',
            })}
          </p>
        )}

        {isPast && (
          <p className="text-xs font-semibold text-amber-400">
            This operation is in the past. Signups are closed, existing
            participants are shown below.
          </p>
        )}
      </header>

      {/* Slots grid */}
      <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 md:gap-6">
        {orbat.slots.map((slot) => (
          <article
            key={slot.id}
            className="rounded-lg border border-slate-700 bg-slate-900/60 p-4 flex flex-col gap-3"
          >
            <h2 className="text-lg font-semibold border-b border-slate-700 pb-2">
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
                      <div className="font-medium">{sub.name}</div>

                      {/* Show participant names only if there are any */}
                      {hasSignup && (
                        <div className="text-xs text-gray-300">
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
                        className="mt-1 sm:mt-0 inline-flex items-center justify-center rounded-md border border-slate-600 px-3 py-1 text-xs font-medium hover:bg-slate-800 transition disabled:opacity-50 disabled:cursor-not-allowed"
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
                        className="mt-1 sm:mt-0 inline-flex items-center justify-center rounded-md border border-red-600 px-3 py-1 text-xs font-medium text-red-400 hover:bg-red-950/50 transition disabled:opacity-50 disabled:cursor-not-allowed"
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
    </div>
  );
}
