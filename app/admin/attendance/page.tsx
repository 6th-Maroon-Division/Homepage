import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { AttendanceAdminRootTabs } from '../components/AttendanceAdminRootTabs';

export default async function AdminAttendancePage() {
  const session = await getServerSession(authOptions);

  if (!session || !session.user?.isAdmin) {
    redirect('/');
  }

  // Get recent orbats with attendance data
  const recentOrbats = await prisma.orbat.findMany({
    where: {
      eventDate: {
        not: null,
      },
    },
    include: {
      attendances: {
        select: {
          status: true,
        },
      },
      _count: {
        select: {
          attendances: true,
        },
      },
    },
    orderBy: {
      eventDate: 'desc',
    },
    take: 50,
  });

  // Serialize dates for client component
  const serializedOrbats = recentOrbats.map(orbat => ({
    ...orbat,
    eventDate: orbat.eventDate,
  }));

  return (
    <main className="min-h-screen">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        <div className="border rounded-lg p-6" style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)' }}>
          <h1 className="text-3xl font-bold mb-2" style={{ color: 'var(--foreground)' }}>
            Attendance Management
          </h1>
          <p style={{ color: 'var(--muted-foreground)' }}>
            View and manage attendance for operations
          </p>
        </div>

        <AttendanceAdminRootTabs orbats={serializedOrbats} />
      </div>
    </main>
  );
}
