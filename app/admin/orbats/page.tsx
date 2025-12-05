import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import CalendarWithOps from '@/app/orbats/CalendarWithOps';
import OrbatManagementClient from '@/app/admin/OrbatManagementClient';

export default async function AdminOrbatsPage() {
  const session = await getServerSession(authOptions);
  
  if (!session?.user?.isAdmin) {
    redirect('/');
  }

  const orbats = await prisma.orbat.findMany({
    include: {
      createdBy: {
        select: {
          id: true,
          username: true,
        },
      },
      slots: {
        include: {
          subslots: {
            include: {
              signups: true,
            },
          },
        },
      },
    },
    orderBy: [
      { eventDate: 'asc' },
      { createdAt: 'asc' },
    ],
  });

  // For calendar view
  const uiOps = orbats.map((orbat) => {
    const date = orbat.eventDate ?? orbat.createdAt;
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, '0');
    const day = `${date.getDate()}`.padStart(2, '0');
    const dateKey = `${year}-${month}-${day}`;

    return {
      id: orbat.id,
      name: orbat.name,
      description: orbat.description,
      eventDate: date.toISOString(),
      dateKey,
    };
  });

  // For table view
  const orbatsWithCounts = orbats.map((orbat) => {
    const totalSubslots = orbat.slots.reduce((acc: number, slot) => acc + slot.subslots.length, 0);
    const totalSignups = orbat.slots.reduce(
      (acc: number, slot) => acc + slot.subslots.reduce((subAcc: number, subslot) => subAcc + subslot.signups.length, 0),
      0
    );
    
    return {
      id: orbat.id,
      name: orbat.name,
      description: orbat.description,
      eventDate: orbat.eventDate ? orbat.eventDate.toISOString() : null,
      createdAt: orbat.createdAt.toISOString(),
      createdBy: {
        id: orbat.createdBy.id,
        username: orbat.createdBy.username || 'Unknown',
      },
      slotCount: orbat.slots.length,
      totalSubslots,
      totalSignups,
    };
  });

  const now = new Date();
  const initialYear = now.getFullYear();
  const initialMonth = now.getMonth(); // 0-based

  return (
    <main className="min-h-screen">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        <header className="space-y-2">
          <h1 className="text-2xl sm:text-3xl font-bold" style={{ color: 'var(--foreground)' }}>OrbAT Management</h1>
          <p className="text-sm sm:text-base" style={{ color: 'var(--muted-foreground)' }}>
            Search, filter, and manage operations below. Use the calendar to quickly create new operations.
          </p>
        </header>

        {/* Table View with Filters */}
        <OrbatManagementClient orbats={orbatsWithCounts} />

        {/* Calendar View */}
        <div className="pt-6 space-y-4" style={{ borderTop: '1px solid var(--border)' }}>
          <div>
            <h2 className="text-xl font-bold" style={{ color: 'var(--foreground)' }}>Quick Create Calendar</h2>
            <p className="text-sm mt-1" style={{ color: 'var(--muted-foreground)' }}>
              Click any empty day to create a new operation for that date. Click days with operations to view or manage them.
            </p>
          </div>
          <CalendarWithOps 
            initialYear={initialYear} 
            initialMonth={initialMonth} 
            ops={uiOps}
            isAdmin={true}
          />
        </div>
      </div>
    </main>
  );
}
