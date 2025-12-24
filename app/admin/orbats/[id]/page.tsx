// app/admin/orbats/[id]/page.tsx
import { prisma } from '@/lib/prisma';
import { notFound, redirect } from 'next/navigation';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import AdminOrbatView from '@/app/components/orbat/AdminOrbatView';

interface AdminOrbatPageProps {
  params: Promise<{ id: string }>;
}

export default async function AdminOrbatPage({ params }: AdminOrbatPageProps) {
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

  // Serialize for client component
  const clientOrbat = {
    id: orbat.id,
    name: orbat.name,
    description: orbat.description,
    eventDate: orbat.eventDate ? orbat.eventDate.toISOString() : null,
    slots: orbat.slots.map((slot) => ({
      id: slot.id,
      name: slot.name,
      orderIndex: slot.orderIndex,
      subslots: slot.subslots.map((sub) => ({
        id: sub.id,
        name: sub.name,
        orderIndex: sub.orderIndex,
        maxSignups: sub.maxSignups,
        signups: sub.signups.map((s) => ({
          id: s.id,
          user: s.user
            ? {
                id: s.user.id,
                username: s.user.username ?? 'Unknown',
              }
            : {
                id: null,
                username: 'Unknown',
              },
        })),
      })),
    })),
  };

  return (
    <main className="min-h-screen">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <AdminOrbatView orbat={clientOrbat} />
      </div>
    </main>
  );
}
