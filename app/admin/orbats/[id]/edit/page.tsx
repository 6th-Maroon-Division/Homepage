// app/admin/orbats/[id]/edit/page.tsx
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { redirect, notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import OrbatForm from '@/app/components/orbat/OrbatForm';

interface EditOrbatPageProps {
  params: Promise<{ id: string }>;
}

export default async function EditOrbatPage({ params }: EditOrbatPageProps) {
  const session = await getServerSession(authOptions);

  if (!session || !session.user?.isAdmin) {
    redirect('/');
  }

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
          },
        },
      },
    },
  });

  if (!orbat) {
    notFound();
  }

  // Serialize for client component
  const initialData = {
    id: orbat.id,
    name: orbat.name,
    description: orbat.description || '',
    eventDate: orbat.eventDate ? orbat.eventDate.toISOString().slice(0, 10) : '',
    startTime: orbat.startTime || '',
    endTime: orbat.endTime || '',
    slots: orbat.slots.map((slot) => ({
      id: slot.id,
      name: slot.name,
      orderIndex: slot.orderIndex,
      subslots: slot.subslots.map((sub) => ({
        id: sub.id,
        name: sub.name,
        orderIndex: sub.orderIndex,
        maxSignups: sub.maxSignups,
      })),
    })),
  };

  return (
    <main className="min-h-screen">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        <header className="space-y-2">
          <h1 className="text-2xl sm:text-3xl font-bold">Edit OrbAT</h1>
          <p className="text-sm sm:text-base" style={{ color: 'var(--muted-foreground)' }}>
            Modify operation details, slots, and subslots
          </p>
        </header>

        <OrbatForm mode="edit" initialData={initialData} />
      </div>
    </main>
  );
}
