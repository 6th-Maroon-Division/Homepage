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

// GET /api/loa - Get current user's LOA entries
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const entries = await prisma.leaveOfAbsence.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json(
      entries.map((entry) => ({
        ...entry,
        startDate: entry.startDate.toISOString(),
        returnDate: entry.returnDate ? entry.returnDate.toISOString() : null,
        cancelledAt: entry.cancelledAt ? entry.cancelledAt.toISOString() : null,
        createdAt: entry.createdAt.toISOString(),
        updatedAt: entry.updatedAt.toISOString(),
      }))
    );
  } catch (error) {
    console.error('Error fetching LOA entries:', error);
    return NextResponse.json({ error: 'Failed to fetch LOA entries' }, { status: 500 });
  }
}

// POST /api/loa - Create a LOA entry for current user
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const startDate = parseDate(body.startDate);
    const returnDate = body.returnDate == null || body.returnDate === '' ? null : parseDate(body.returnDate);
    const reason = typeof body.reason === 'string' ? body.reason.trim() : null;

    if (!startDate) {
      return NextResponse.json({ error: 'Valid startDate is required' }, { status: 400 });
    }

    if (body.returnDate != null && body.returnDate !== '' && !returnDate) {
      return NextResponse.json({ error: 'returnDate must be a valid date' }, { status: 400 });
    }

    if (returnDate && returnDate < startDate) {
      return NextResponse.json({ error: 'returnDate cannot be before startDate' }, { status: 400 });
    }

    const created = await prisma.leaveOfAbsence.create({
      data: {
        userId: session.user.id,
        startDate,
        returnDate,
        reason: reason || null,
      },
    });

    return NextResponse.json(
      {
        ...created,
        startDate: created.startDate.toISOString(),
        returnDate: created.returnDate ? created.returnDate.toISOString() : null,
        cancelledAt: created.cancelledAt ? created.cancelledAt.toISOString() : null,
        createdAt: created.createdAt.toISOString(),
        updatedAt: created.updatedAt.toISOString(),
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Error creating LOA entry:', error);
    return NextResponse.json({ error: 'Failed to create LOA entry' }, { status: 500 });
  }
}
