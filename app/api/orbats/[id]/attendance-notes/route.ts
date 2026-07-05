import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import { checkPermission } from '@/lib/auth-middleware';

type RouteParams = {
  params: Promise<{ id: string }>;
};

type NoteStatus = 'absent' | 'unsure' | 'late_unsure';

function parsePositiveInt(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const num = Number(value);
  if (!Number.isInteger(num) || num < 0) {
    return null;
  }

  return num;
}

function normalizeReason(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 500) : null;
}

function isValidStatus(value: unknown): value is NoteStatus {
  return value === 'absent' || value === 'unsure' || value === 'late_unsure';
}

export async function GET(_req: NextRequest, context: RouteParams) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await context.params;
    const orbatId = Number(id);
    if (Number.isNaN(orbatId)) {
      return NextResponse.json({ error: 'Invalid ORBAT id' }, { status: 400 });
    }

    const orbat = await prisma.orbat.findUnique({
      where: { id: orbatId },
      select: { id: true },
    });
    if (!orbat) {
      return NextResponse.json({ error: 'ORBAT not found' }, { status: 404 });
    }

    const notes = await prisma.orbatAttendanceNote.findMany({
      where: { orbatId },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            userRank: {
              include: {
                currentRank: {
                  select: { abbreviation: true, name: true },
                },
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    return NextResponse.json(notes);
  } catch (error) {
    console.error('Error fetching attendance notes:', error);
    return NextResponse.json({ error: 'Failed to fetch attendance notes' }, { status: 500 });
  }
}

export async function POST(req: NextRequest, context: RouteParams) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const actorUserId = Number(session.user.id);
    const { id } = await context.params;
    const orbatId = Number(id);

    if (Number.isNaN(orbatId)) {
      return NextResponse.json({ error: 'Invalid ORBAT id' }, { status: 400 });
    }

    const body = await req.json();
    const status = body?.status;
    const targetUserIdRaw = body?.userId;

    if (!isValidStatus(status)) {
      return NextResponse.json({ error: 'Invalid status. Expected absent, unsure, or late_unsure.' }, { status: 400 });
    }

    const targetUserId = typeof targetUserIdRaw === 'number' ? targetUserIdRaw : actorUserId;
    const isAdminOverride = targetUserId !== actorUserId;

    if (isAdminOverride) {
      const canEditOrbat = await checkPermission(actorUserId, 'orbat:edit');
      if (!canEditOrbat) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

    const reason = normalizeReason(body?.reason);
    const lateMinutes = parsePositiveInt(body?.lateMinutes);
    const leaveEarlyMinutes = parsePositiveInt(body?.leaveEarlyMinutes);

    if (status === 'late_unsure' && lateMinutes === null && leaveEarlyMinutes === null) {
      return NextResponse.json(
        { error: 'Please provide how late or how early you are leaving.' },
        { status: 400 }
      );
    }

    const [orbat, user] = await Promise.all([
      prisma.orbat.findUnique({
        where: { id: orbatId },
        select: { id: true, eventDate: true, startTime: true, endTime: true },
      }),
      prisma.user.findUnique({ where: { id: targetUserId }, select: { id: true } }),
    ]);

    if (!orbat) {
      return NextResponse.json({ error: 'ORBAT not found' }, { status: 404 });
    }

    if (!isAdminOverride) {
      const operationCutoff = (() => {
        if (!orbat.eventDate) {
          return null;
        }

        const cutoff = new Date(orbat.eventDate);
        const timeValue = orbat.endTime || orbat.startTime;

        if (timeValue && /^\d{2}:\d{2}$/.test(timeValue)) {
          const [hour, minute] = timeValue.split(':').map(Number);
          cutoff.setHours(hour, minute, 0, 0);
        } else {
          cutoff.setHours(23, 59, 59, 999);
        }

        return cutoff;
      })();

      if (operationCutoff && operationCutoff < new Date()) {
        return NextResponse.json(
          { error: 'Operation is in the past. Attendance notes are closed.' },
          { status: 400 }
        );
      }
    }

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
    const note = await prisma.orbatAttendanceNote.upsert({
      where: {
        orbatId_userId: {
          orbatId,
          userId: targetUserId,
        },
      },
      update: {
        status,
        reason,
        lateMinutes: status === 'late_unsure' ? lateMinutes : null,
        leaveEarlyMinutes: status === 'late_unsure' ? leaveEarlyMinutes : null,
      },
      create: {
        orbatId,
        userId: targetUserId,
        status,
        reason,
        lateMinutes: status === 'late_unsure' ? lateMinutes : null,
        leaveEarlyMinutes: status === 'late_unsure' ? leaveEarlyMinutes : null,
      },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            userRank: {
              include: {
                currentRank: {
                  select: { abbreviation: true, name: true },
                },
              },
            },
          },
        },
      },
    });

    return NextResponse.json(note);
  } catch (error) {
    console.error('Error upserting attendance note:', error);
    return NextResponse.json({ error: 'Failed to save attendance note' }, { status: 500 });
  }
}
