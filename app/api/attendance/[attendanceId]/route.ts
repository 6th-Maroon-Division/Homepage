import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';

/**
 * GET /api/attendance/[attendanceId]
 * Fetch a single attendance record
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ attendanceId: string }> }) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.isAdmin) {
    return NextResponse.json(
      { error: 'Unauthorized - admin access required' },
      { status: 401 }
    );
  }

  try {
    const { attendanceId } = await params;
    const id = parseInt(attendanceId);

    const attendance = await prisma.attendance.findUnique({
      where: { id },
      include: {
        signup: {
          include: {
            user: true,
          },
        },
      },
    });

    if (!attendance) {
      return NextResponse.json(
        { error: 'Attendance record not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(attendance);
  } catch (error) {
    console.error('Error fetching attendance:', error);
    return NextResponse.json(
      { error: 'Failed to fetch attendance' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/attendance/[attendanceId]
 * Update an attendance record
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ attendanceId: string }> }) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.isAdmin) {
    return NextResponse.json(
      { error: 'Unauthorized - admin access required' },
      { status: 401 }
    );
  }

  try {
    const { attendanceId } = await params;
    const id = parseInt(attendanceId);
    const { signupId, userId, status, notes } = await request.json();

    const updated = await prisma.attendance.update({
      where: { id },
      data: {
        ...(signupId ? { signup: { connect: { id: signupId } } } : { signup: { disconnect: true } }),
        ...(userId ? { user: { connect: { id: userId } } } : {}),
        status,
        notes,
      },
      include: {
        signup: {
          include: {
            user: true,
          },
        },
      },
    });

    // Log the update
    await prisma.attendanceLog.create({
      data: {
        attendanceId: updated.id,
        action: 'updated',
        changedById: session.user?.id || null,
        source: 'manual',
      },
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error('Error updating attendance:', error);
    return NextResponse.json(
      { error: 'Failed to update attendance' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/attendance/[attendanceId]
 * Delete an attendance record
 */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ attendanceId: string }> }) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.isAdmin) {
    return NextResponse.json(
      { error: 'Unauthorized - admin access required' },
      { status: 401 }
    );
  }

  try {
    const { attendanceId } = await params;
    const id = parseInt(attendanceId);

    // Log the deletion
    await prisma.attendanceLog.create({
      data: {
        attendanceId: id,
        action: 'deleted',
        changedById: session.user?.id || null,
        source: 'manual',
      },
    });

    await prisma.attendance.delete({
      where: { id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting attendance:', error);
    return NextResponse.json(
      { error: 'Failed to delete attendance' },
      { status: 500 }
    );
  }
}
