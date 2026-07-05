import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import { checkPermission } from '@/lib/auth-middleware';

type RouteParams = {
  params: Promise<{ id: string; noteId: string }>;
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

async function canManageNote(actorUserId: number, noteOwnerId: number): Promise<boolean> {
  if (actorUserId === noteOwnerId) {
    return true;
  }

  return checkPermission(actorUserId, 'orbat:edit');
}

export async function PATCH(req: NextRequest, context: RouteParams) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const actorUserId = Number(session.user.id);
    const { id, noteId } = await context.params;
    const orbatId = Number(id);
    const parsedNoteId = Number(noteId);

    if (Number.isNaN(orbatId) || Number.isNaN(parsedNoteId)) {
      return NextResponse.json({ error: 'Invalid parameters' }, { status: 400 });
    }

    const existing = await prisma.orbatAttendanceNote.findFirst({
      where: {
        id: parsedNoteId,
        orbatId,
      },
      select: {
        id: true,
        userId: true,
      },
    });

    if (!existing) {
      return NextResponse.json({ error: 'Attendance note not found' }, { status: 404 });
    }

    const canManage = await canManageNote(actorUserId, existing.userId);
    if (!canManage) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await req.json();
    const status = body?.status;
    if (!isValidStatus(status)) {
      return NextResponse.json({ error: 'Invalid status. Expected absent, unsure, or late_unsure.' }, { status: 400 });
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

    const updated = await prisma.orbatAttendanceNote.update({
      where: { id: parsedNoteId },
      data: {
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

    return NextResponse.json(updated);
  } catch (error) {
    console.error('Error updating attendance note:', error);
    return NextResponse.json({ error: 'Failed to update attendance note' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, context: RouteParams) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const actorUserId = Number(session.user.id);
    const { id, noteId } = await context.params;
    const orbatId = Number(id);
    const parsedNoteId = Number(noteId);

    if (Number.isNaN(orbatId) || Number.isNaN(parsedNoteId)) {
      return NextResponse.json({ error: 'Invalid parameters' }, { status: 400 });
    }

    const existing = await prisma.orbatAttendanceNote.findFirst({
      where: {
        id: parsedNoteId,
        orbatId,
      },
      select: {
        id: true,
        userId: true,
      },
    });

    if (!existing) {
      return NextResponse.json({ error: 'Attendance note not found' }, { status: 404 });
    }

    const canManage = await canManageNote(actorUserId, existing.userId);
    if (!canManage) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    await prisma.orbatAttendanceNote.delete({ where: { id: parsedNoteId } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting attendance note:', error);
    return NextResponse.json({ error: 'Failed to delete attendance note' }, { status: 500 });
  }
}
