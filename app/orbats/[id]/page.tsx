// app/orbats/[id]/page.tsx
import { prisma } from '@/lib/prisma';
import { notFound } from 'next/navigation';

interface OrbatPageProps {
  params: Promise<{ id: string }>;
}

export default async function OrbatPage({ params }: OrbatPageProps) {
  const { id } = await params;
  const orbatId = Number(id);

  if (Number.isNaN(orbatId)) {
    notFound();
  }

  const orbat = await prisma.orbat.findUnique({
    where: { id: orbatId },
    include: {
      slots: {
        orderBy: { orderIndex: 'asc' },
        include: {
          subslots: {
            orderBy: { orderIndex: 'asc' },
            include: {
              signups: {
                include: { user: true },
              },
            },
          },
        },
      },
      createdBy: true,
    },
  });

  if (!orbat) {
    notFound();
  }

  const now = new Date();
  const isPast = orbat.eventDate ? orbat.eventDate < now : false;

  return (
    <main className="min-h-screen">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {/* Header */}
        <header className="space-y-2">
          <h1 className="text-2xl sm:text-3xl font-bold">{orbat.name}</h1>

          {orbat.description && (
            <p className="text-sm sm:text-base text-gray-300">
              {orbat.description}
            </p>
          )}

          {orbat.eventDate && (
            <p className="text-xs text-gray-400">
              Event date:{' '}
              {new Date(orbat.eventDate).toLocaleString(undefined, {
                dateStyle: 'medium',
                timeStyle: 'short',
              })}
            </p>
          )}

          {isPast && (
            <p className="text-xs font-semibold text-amber-400">
              This operation is in the past. Signups are closed, existing participants
              are shown below.
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
                  const filled = sub.signups.length;
                  const isFull = filled >= sub.maxSignups;

                  return (
                    <li
                      key={sub.id}
                      className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1"
                    >
                      <div>
                        <div className="font-medium">{sub.name}</div>

                        {/* ONLY show participant names if there are any */}
                        {filled > 0 && (
                          <div className="text-xs text-gray-300">
                            {sub.signups
                              .map((s) => s.user?.username ?? 'Unknown')
                              .join(', ')}
                          </div>
                        )}
                      </div>

                      {/* Signup button:
                          - hidden for past ops
                          - hidden if at least 1 signup (or full)
                          - shown only when future op & empty slot
                      */}
                      {!isPast && !isFull && (
                        <button
                          className="mt-1 sm:mt-0 inline-flex items-center justify-center rounded-md border border-slate-600 px-3 py-1 text-xs font-medium hover:bg-slate-800 transition disabled:opacity-50 disabled:cursor-not-allowed"
                          disabled
                        >
                          Sign up
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
    </main>
  );
}
