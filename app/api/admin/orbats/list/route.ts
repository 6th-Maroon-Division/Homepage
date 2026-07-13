import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { checkPermission } from '@/lib/auth-middleware';
import { prisma } from '@/lib/prisma';

export async function GET() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const hasPermission =
    (session.user.permissions?.['system:super_admin'] ?? 0) > 0 ||
    await checkPermission(session.user.id, 'orbat:edit');

  if (!hasPermission) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const orbats = await prisma.orbat.findMany({
    include: {
      createdBy: {
        select: {
          id: true,
          username: true,
        },
      },
      squads: {
        include: {
          slots: {
            include: {
              signups: true,
            },
          },
        },
      },
    },
    orderBy: [
      { startsAtUtc: 'asc' },
      { eventDate: 'asc' },
      { createdAt: 'asc' },
    ],
  });

  const rows = orbats.map((orbat) => {
    const totalSubslots = orbat.squads.reduce((acc: number, squad) => acc + squad.slots.length, 0);
    const totalSignups = orbat.squads.reduce(
      (acc: number, squad) => acc + squad.slots.reduce((slotAcc: number, slot) => slotAcc + slot.signups.length, 0),
      0
    );

    return {
      id: orbat.id,
      name: orbat.name,
      description: orbat.description,
      startsAtUtc: orbat.startsAtUtc ? orbat.startsAtUtc.toISOString() : null,
      endsAtUtc: orbat.endsAtUtc ? orbat.endsAtUtc.toISOString() : null,
      eventDate: orbat.eventDate ? orbat.eventDate.toISOString() : null,
      startTime: orbat.startTime || null,
      endTime: orbat.endTime || null,
      createdAt: orbat.createdAt.toISOString(),
      createdBy: {
        id: orbat.createdBy.id,
        username: orbat.createdBy.username || 'Unknown',
      },
      slotCount: orbat.squads.length,
      totalSubslots,
      totalSignups,
    };
  });

  return NextResponse.json(rows);
}