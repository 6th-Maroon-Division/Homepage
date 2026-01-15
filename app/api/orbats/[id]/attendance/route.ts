import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import {
  calculateAttendanceStatus,
  calculateTimeDifferences,
} from '@/lib/attendance';

// GET /api/orbats/[id]/attendance - Get all attendance for an orbat
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);

    // Only admins can view attendance
    if (!session?.user?.isAdmin) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { id } = await params;
    const orbatId = parseInt(id);

    // Get query parameters
    const searchParams = request.nextUrl.searchParams;
    const dateParam = searchParams.get('date');
    const userIdParam = searchParams.get('userId');

    // Build where clause - for now just use orbatId and optional userId
    const where: Record<string, unknown> = {
      orbatId,
    };

    if (userIdParam) {
      where.userId = parseInt(userIdParam);
    }

    // Note: Date filtering would need to be applied via raw queries if needed

    const attendances = await prisma.attendance.findMany({
      where: {
        ...where,
      },
      include: {
        user: true, // Always include user
        signup: {
          include: {
            user: true,
            subslot: {
              include: {
                slot: true,
              },
            },
          },
        },
        sessions: {
          orderBy: {
            checkedInAt: 'asc',
          },
        },
        logs: {
          include: {
            changedBy: true,
          },
          orderBy: {
            timestamp: 'desc',
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return NextResponse.json(attendances);
  } catch (error) {
    console.error('Error fetching attendance:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// POST /api/orbats/[id]/attendance - Create new attendance record
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.isAdmin) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { id } = await params;
    const orbatId = parseInt(id);
    const body = await request.json();

    const {
      signupId,
      userId,
      status,
      checkinTime,
      checkoutTime,
      notes,
    } = body;

    // Require either signupId or userId
    if (!signupId && !userId) {
      return NextResponse.json(
        { error: 'Either signupId or userId is required' },
        { status: 400 }
      );
    }

    // Get orbat info
    const orbat = await prisma.orbat.findUnique({
      where: { id: orbatId },
    });

    if (!orbat) {
      return NextResponse.json(
        { error: 'Orbat not found' },
        { status: 404 }
      );
    }

    // If signupId provided, verify it exists and belongs to this orbat
    let signup = null;
    let finalUserId = userId;

    if (signupId) {
      signup = await prisma.signup.findFirst({
        where: {
          id: signupId,
          subslot: {
            slot: {
              orbatId,
            },
          },
        },
        include: {
          user: true,
        },
      });

      if (!signup) {
        return NextResponse.json(
          { error: 'Signup not found or does not belong to this orbat' },
          { status: 404 }
        );
      }

      finalUserId = signup.userId;
    } else if (userId) {
      // Verify user exists
      const user = await prisma.user.findUnique({
        where: { id: userId },
      });

      if (!user) {
        return NextResponse.json(
          { error: 'User not found' },
          { status: 404 }
        );
      }
    }

    // Create attendance record with optional session and log entry
    const attendance = await prisma.$transaction(async (tx) => {
      const newAttendance = await tx.attendance.create({
        data: {
          signupId: signupId || null,
          orbatId,
          userId: finalUserId,
          status: status || 'absent',
          notes,
        },
      });

      // Create session if check-in/check-out times provided
      if (checkinTime) {
        const checkinDate = new Date(checkinTime);
        const checkoutDate = checkoutTime ? new Date(checkoutTime) : null;
        const durationMs = checkoutDate
          ? checkoutDate.getTime() - checkinDate.getTime()
          : 0;
        const durationMinutes =
          durationMs > 0 ? Math.ceil(durationMs / (1000 * 60)) : null;

        await tx.attendanceSession.create({
          data: {
            userId: newAttendance.userId,
            attendanceId: newAttendance.id,
            sessionDate: checkinDate,
            checkedInAt: checkinDate,
            checkedOutAt: checkoutDate,
            durationMinutes,
          },
        });

        // Recalculate time differences if we have sessions
        const timeDiffs = calculateTimeDifferences(
          orbat.startTime,
          orbat.endTime,
          checkinDate,
          checkoutDate,
          orbat.eventDate
        );

        const calculatedStatus = calculateAttendanceStatus(
          true,
          timeDiffs.minutesLate,
          timeDiffs.minutesGoneEarly,
          timeDiffs.totalMinutesMissed,
          status === 'absent'
        );

        // Update attendance with calculated values
        await tx.attendance.update({
          where: { id: newAttendance.id },
          data: {
            status: calculatedStatus,
            minutesLate: timeDiffs.minutesLate,
            minutesGoneEarly: timeDiffs.minutesGoneEarly,
            totalMinutesMissed: timeDiffs.totalMinutesMissed,
            totalMinutesPresent: durationMinutes || 0,
          },
        });
      }

      // Create log entry
      await tx.attendanceLog.create({
        data: {
          attendanceId: newAttendance.id,
          action: 'created',
          source: 'manual',
          changedById: session.user?.id,
          newValue: {
            status: status || 'absent',
            notes,
          },
        },
      });

      return tx.attendance.findUnique({
        where: { id: newAttendance.id },
        include: {
          user: true,
          signup: {
            include: {
              user: true,
              subslot: {
                include: {
                  slot: true,
                },
              },
            },
          },
          sessions: true,
          logs: true,
        },
      });
    });

    return NextResponse.json(attendance, { status: 201 });
  } catch (error) {
    console.error('Error creating attendance:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
