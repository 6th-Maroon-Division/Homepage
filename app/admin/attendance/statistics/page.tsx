import Link from 'next/link';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { checkPermission } from '@/lib/auth-middleware';

type AttendanceStatus = 'present' | 'absent' | 'late' | 'gone_early' | 'partial' | 'no_show';

type OrbatWithAttendance = {
  id: number;
  name: string;
  eventDate: Date | null;
  attendances: Array<{ status: AttendanceStatus }>;
};

type AggregateMetrics = {
  opCount: number;
  avgAttendees: number;
  avgLate: number;
  avgGoneEarly: number;
  totalLate: number;
  totalGoneEarly: number;
};

const attendedStatuses = new Set<AttendanceStatus>(['present', 'late', 'gone_early', 'partial']);

const countByStatus = (orbat: OrbatWithAttendance, status: AttendanceStatus) =>
  orbat.attendances.filter((entry) => entry.status === status).length;

const countAttended = (orbat: OrbatWithAttendance) =>
  orbat.attendances.filter((entry) => attendedStatuses.has(entry.status)).length;

const calculateAggregateMetrics = (orbats: OrbatWithAttendance[]): AggregateMetrics => {
  if (orbats.length === 0) {
    return {
      opCount: 0,
      avgAttendees: 0,
      avgLate: 0,
      avgGoneEarly: 0,
      totalLate: 0,
      totalGoneEarly: 0,
    };
  }

  const totals = orbats.reduce(
    (acc, orbat) => {
      acc.attended += countAttended(orbat);
      acc.late += countByStatus(orbat, 'late');
      acc.goneEarly += countByStatus(orbat, 'gone_early');
      return acc;
    },
    { attended: 0, late: 0, goneEarly: 0 }
  );

  return {
    opCount: orbats.length,
    avgAttendees: totals.attended / orbats.length,
    avgLate: totals.late / orbats.length,
    avgGoneEarly: totals.goneEarly / orbats.length,
    totalLate: totals.late,
    totalGoneEarly: totals.goneEarly,
  };
};

export default async function AdminAttendanceStatisticsPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    redirect('/');
  }

  const [canViewAttendance, canEditAttendance] = await Promise.all([
    checkPermission(session.user.id, 'attendance:view'),
    checkPermission(session.user.id, 'attendance:edit'),
  ]);

  const hasSuperAdmin = (session.user.permissions?.['system:super_admin'] ?? 0) > 0;
  const hasPermission = hasSuperAdmin || canViewAttendance || canEditAttendance;

  if (!hasPermission) {
    redirect('/admin');
  }

  const now = new Date();

  const orbats = await prisma.orbat.findMany({
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
    },
    orderBy: {
      eventDate: 'desc',
    },
    take: 100,
  });

  const pastOrbats: OrbatWithAttendance[] = orbats
    .filter((orbat) => orbat.eventDate && new Date(orbat.eventDate) < now)
    .map((orbat) => ({
      id: orbat.id,
      name: orbat.name,
      eventDate: orbat.eventDate,
      attendances: orbat.attendances.map((a) => ({ status: a.status as AttendanceStatus })),
    }));

  const last30DaysCutoff = new Date(now);
  last30DaysCutoff.setDate(last30DaysCutoff.getDate() - 30);

  const last30DaysOrbats = pastOrbats.filter(
    (orbat) => orbat.eventDate && new Date(orbat.eventDate) >= last30DaysCutoff
  );

  const recent4Orbats = pastOrbats.slice(0, 4);
  const recent8Orbats = pastOrbats.slice(0, 8);
  const recent12Orbats = pastOrbats.slice(0, 12);

  const metrics30 = calculateAggregateMetrics(last30DaysOrbats);
  const metrics4 = calculateAggregateMetrics(recent4Orbats);
  const metrics8 = calculateAggregateMetrics(recent8Orbats);
  const metrics12 = calculateAggregateMetrics(recent12Orbats);

  const sixMonthTrend = (() => {
    const months: Array<{ key: string; label: string; ops: OrbatWithAttendance[] }> = [];

    for (let i = 5; i >= 0; i -= 1) {
      const monthDate = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${monthDate.getFullYear()}-${monthDate.getMonth()}`;
      months.push({
        key,
        label: monthDate.toLocaleString('en-GB', { month: 'short' }),
        ops: [],
      });
    }

    const monthMap = new Map(months.map((month) => [month.key, month]));
    for (const orbat of pastOrbats) {
      if (!orbat.eventDate) continue;
      const date = new Date(orbat.eventDate);
      const key = `${date.getFullYear()}-${date.getMonth()}`;
      const bucket = monthMap.get(key);
      if (bucket) {
        bucket.ops.push(orbat);
      }
    }

    return months.map((month) => {
      const metrics = calculateAggregateMetrics(month.ops);
      return {
        month: month.label,
        opCount: metrics.opCount,
        avgAttendees: metrics.avgAttendees,
        avgLate: metrics.avgLate,
        avgGoneEarly: metrics.avgGoneEarly,
      };
    });
  })();

  const formatDecimal = (value: number) =>
    value.toLocaleString('de-DE', {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    });

  const MetricCard = ({ title, metrics }: { title: string; metrics: AggregateMetrics }) => (
    <div className="rounded border p-4" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--background)' }}>
      <div className="text-sm mb-2" style={{ color: 'var(--muted-foreground)' }}>{title}</div>
      <div className="text-2xl font-semibold" style={{ color: 'var(--foreground)' }}>
        {formatDecimal(metrics.avgAttendees)} avg attendees
      </div>
      <div className="text-xs mt-1" style={{ color: 'var(--muted-foreground)' }}>{metrics.opCount} ops</div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
        <div>
          <div style={{ color: 'var(--muted-foreground)' }}>Late avg/op</div>
          <div className="font-medium" style={{ color: 'var(--foreground)' }}>{formatDecimal(metrics.avgLate)}</div>
        </div>
        <div>
          <div style={{ color: 'var(--muted-foreground)' }}>Early avg/op</div>
          <div className="font-medium" style={{ color: 'var(--foreground)' }}>{formatDecimal(metrics.avgGoneEarly)}</div>
        </div>
        <div>
          <div style={{ color: 'var(--muted-foreground)' }}>Late total</div>
          <div className="font-medium" style={{ color: 'var(--foreground)' }}>{metrics.totalLate}</div>
        </div>
        <div>
          <div style={{ color: 'var(--muted-foreground)' }}>Early total</div>
          <div className="font-medium" style={{ color: 'var(--foreground)' }}>{metrics.totalGoneEarly}</div>
        </div>
      </div>
    </div>
  );

  return (
    <main className="min-h-screen">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        <div className="border rounded-lg p-6" style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)' }}>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold mb-2" style={{ color: 'var(--foreground)' }}>
                Attendance Statistics
              </h1>
              <p style={{ color: 'var(--muted-foreground)' }}>
                Operation attendance averages and late/early behavior across rolling windows.
              </p>
            </div>
            <Link
              href="/admin/attendance"
              className="px-4 py-2 rounded border text-sm font-medium"
              style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }}
            >
              Back to Attendance
            </Link>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          <MetricCard title="Last 30 Days" metrics={metrics30} />
          <MetricCard title="Last 4 Ops" metrics={metrics4} />
          <MetricCard title="Last 8 Ops" metrics={metrics8} />
          <MetricCard title="Last 12 Ops" metrics={metrics12} />
        </div>

        <div className="rounded border p-4" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--secondary)' }}>
          <h2 className="text-xl font-semibold mb-3" style={{ color: 'var(--foreground)' }}>
            6-Month Trend
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
            {sixMonthTrend.map((point) => (
              <div key={point.month} className="rounded border p-3 text-center" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--background)' }}>
                <div className="text-xs" style={{ color: 'var(--muted-foreground)' }}>{point.month}</div>
                <div className="text-lg font-semibold" style={{ color: 'var(--foreground)' }}>
                  {formatDecimal(point.avgAttendees)}
                </div>
                <div className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
                  {point.opCount} ops
                </div>
                <div className="text-xs mt-2" style={{ color: 'var(--muted-foreground)' }}>
                  Late {formatDecimal(point.avgLate)} / Early {formatDecimal(point.avgGoneEarly)}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
