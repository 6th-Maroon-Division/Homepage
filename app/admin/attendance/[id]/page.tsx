import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import AttendanceManagement from '@/app/admin/components/AttendanceManagement';
import Link from 'next/link';

export default async function OrbatAttendancePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getServerSession(authOptions);

  if (!session || !session.user?.isAdmin) {
    redirect('/');
  }

  const { id } = await params;
  const orbatId = parseInt(id);

  const orbat = await prisma.orbat.findUnique({
    where: { id: orbatId },
    include: {
      createdBy: true,
    },
  });

  if (!orbat) {
    redirect('/admin/attendance');
  }

  return (
    <main className="min-h-screen">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        <div className="border rounded-lg p-6" style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)' }}>
          <Link
            href="/admin/attendance"
            className="text-sm mb-3 inline-block hover:underline"
            style={{ color: 'var(--accent)' }}
          >
            ← Back to Attendance
          </Link>
          <h1 className="text-3xl font-bold mb-2" style={{ color: 'var(--foreground)' }}>
            {orbat.name}
          </h1>
          <div className="flex gap-4 text-sm" style={{ color: 'var(--muted-foreground)' }}>
            <span>
              Date:{' '}
              {orbat.eventDate
                ? new Date(orbat.eventDate).toLocaleDateString()
                : 'Not set'}
            </span>
            {orbat.startTime && orbat.endTime && (
              <span>
                Time: {orbat.startTime} - {orbat.endTime}
              </span>
            )}
          </div>
        </div>

        <div
          className="border rounded-lg p-6"
          style={{
            backgroundColor: 'var(--secondary)',
            borderColor: 'var(--border)',
          }}
        >
          <AttendanceManagement orbatId={orbatId} />
        </div>
      </div>
    </main>
  );
}
