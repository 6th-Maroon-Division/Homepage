import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';

function parseDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date;
}

// PATCH /api/loa/[id] - Update current user's LOA entry (mainly return date)
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await context.params;
    const loaId = Number.parseInt(id, 10);
    if (Number.isNaN(loaId)) {
      return NextResponse.json({ error: 'Invalid LOA id' }, { status: 400 });
    }

    const existing = await prisma.leaveOfAbsence.findUnique({
      where: { id: loaId },
      select: { id: true, userId: true, startDate: true },
    });

    if (!existing) {
      return NextResponse.json({ error: 'LOA entry not found' }, { status: 404 });
    }

    if (existing.userId !== session.user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const hasReturnDate = Object.prototype.hasOwnProperty.call(body, 'returnDate');
    const hasReason = Object.prototype.hasOwnProperty.call(body, 'reason');
    const hasCancel = Object.prototype.hasOwnProperty.call(body, 'cancel');

    if (!hasReturnDate && !hasReason && !hasCancel) {
      return NextResponse.json({ error: 'At least one field (returnDate, reason, or cancel) is required' }, { status: 400 });
    }

    const cancel = hasCancel ? body.cancel === true : false;

    let returnDate: Date | null | undefined;
    if (hasReturnDate) {
      if (body.returnDate == null || body.returnDate === '') {
        returnDate = null;
      } else {
        returnDate = parseDate(body.returnDate);
        if (!returnDate) {
          return NextResponse.json({ error: 'returnDate must be a valid date' }, { status: 400 });
        }
        if (returnDate < existing.startDate) {
          return NextResponse.json({ error: 'returnDate cannot be before startDate' }, { status: 400 });
        }
      }
    }

    const reason = hasReason
      ? (typeof body.reason === 'string' ? body.reason.trim() || null : null)
      : undefined;

    const updated = await prisma.leaveOfAbsence.update({
      where: { id: loaId },
      data: {
        ...(hasReturnDate ? { returnDate } : {}),
        ...(hasReason ? { reason } : {}),
        ...(hasCancel ? { cancelledAt: cancel ? new Date() : null } : {}),
      },
    });

    return NextResponse.json({
      ...updated,
      startDate: updated.startDate.toISOString(),
      returnDate: updated.returnDate ? updated.returnDate.toISOString() : null,
      cancelledAt: updated.cancelledAt ? updated.cancelledAt.toISOString() : null,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    });
  } catch (error: unknown) {
    console.error('Error updating LOA entry:', error);

    if ((error as { code?: string }).code === 'P2025') {
      return NextResponse.json({ error: 'LOA entry not found' }, { status: 404 });
    }

    return NextResponse.json({ error: 'Failed to update LOA entry' }, { status: 500 });
  }
}

