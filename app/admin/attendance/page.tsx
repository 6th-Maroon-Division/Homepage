import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { AttendanceAdminRootTabs } from '../components/AttendanceAdminRootTabs';
import { checkPermission } from '@/lib/auth-middleware';

export default async function AdminAttendancePage() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    redirect('/');
  }
  
  // Check if user has attendance view or edit permission
  const [canViewAttendance, canEditAttendance] = await Promise.all([
    checkPermission(session.user.id, 'attendance:view'),
    checkPermission(session.user.id, 'attendance:edit'),
  ]);
  const hasSuperAdmin = (session.user.permissions?.['system:super_admin'] ?? 0) > 0;
  const hasPermission = hasSuperAdmin || canViewAttendance || canEditAttendance;
  
  if (!hasPermission) {
    redirect('/admin');
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
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold mb-2" style={{ color: 'var(--foreground)' }}>
                Attendance Management
              </h1>
              <p style={{ color: 'var(--muted-foreground)' }}>
                View and manage attendance for operations
              </p>
            </div>

            <Link
              href="/admin/attendance/statistics"
              className="px-4 py-2 rounded border text-sm font-medium"
              style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }}
            >
              View Statistics
            </Link>
          </div>
        </div>

        <AttendanceAdminRootTabs orbats={serializedOrbats} />
      </div>
    </main>
  );
}
