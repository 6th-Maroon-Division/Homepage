import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  calculateAttendanceStatus,
  calculateTimeDifferences,
} from '@/lib/attendance';

/**
 * POST /api/orbats/[id]/attendance/automation
 * Automation endpoint for check-in/check-out based on SteamID
 * Body: { steamId: string, checkinTime?: string, checkoutTime?: string }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const orbatId = parseInt(id);
    const body = await request.json();

    const { steamId, checkinTime, checkoutTime } = body;

    if (!steamId) {
      return NextResponse.json(
        { error: 'steamId is required' },
        { status: 400 }
      );
    }

    if (!checkinTime && !checkoutTime) {
      return NextResponse.json(
        { error: 'Either checkinTime or checkoutTime is required' },
        { status: 400 }
      );
    }

    // Find user by SteamID via AuthAccount
    const authAccount = await prisma.authAccount.findUnique({
      where: {
        provider_providerUserId: {
          provider: 'steam',
          providerUserId: steamId,
        },
      },
      include: {
        user: true,
      },
    });

    if (!authAccount) {
      return NextResponse.json(
        { error: 'User not found with provided steamId' },
        { status: 404 }
      );
    }

    const userId = authAccount.user.id;

    // Get orbat info for time calculations
    const orbat = await prisma.orbat.findUnique({
      where: { id: orbatId },
    });

    if (!orbat) {
      return NextResponse.json(
        { error: 'Orbat not found' },
        { status: 404 }
      );
    }

    // Check if user has a signup for this orbat
    const signup = await prisma.signup.findFirst({
      where: {
        userId,
        subslot: {
          slot: {
            orbatId,
          },
        },
      },
    });

    const result = await prisma.$transaction(async (tx) => {
      // Find or create attendance record
      let attendance = await tx.attendance.findFirst({
        where: {
          orbatId,
          userId,
        },
      });

      if (!attendance) {
        // Create new attendance record
        attendance = await tx.attendance.create({
          data: {
            orbatId,
            userId,
            signupId: signup?.id || null,
            status: 'no_show', // Will be updated after processing sessions
            notes: 'Created by automation',
          },
        });

        // Log creation
        await tx.attendanceLog.create({
          data: {
            attendanceId: attendance.id,
            action: 'created',
            source: 'automated_system',
            changedById: null,
          },
        });
      }

      // Handle check-in
      if (checkinTime) {
        const checkinDate = new Date(checkinTime);
        
        // Check if there's an open session (checked in but not out)
        const openSession = await tx.attendanceSession.findFirst({
          where: {
            userId,
            attendanceId: attendance.id,
            checkedOutAt: null,
          },
          orderBy: {
            checkedInAt: 'desc',
          },
        });

        if (!openSession) {
          // Create new session
          await tx.attendanceSession.create({
            data: {
              userId,
              attendanceId: attendance.id,
              sessionDate: checkinDate,
              checkedInAt: checkinDate,
              checkedOutAt: null,
              durationMinutes: null,
            },
          });
        }
      }

      // Handle check-out
      if (checkoutTime) {
        const checkoutDate = new Date(checkoutTime);

        // Find the most recent open session
        const openSession = await tx.attendanceSession.findFirst({
          where: {
            userId,
            attendanceId: attendance.id,
            checkedOutAt: null,
          },
          orderBy: {
            checkedInAt: 'desc',
          },
        });

        if (openSession) {
          // Update session with check-out time
          const durationMs = checkoutDate.getTime() - openSession.checkedInAt.getTime();
          const durationMinutes = Math.ceil(durationMs / (1000 * 60));

          await tx.attendanceSession.update({
            where: { id: openSession.id },
            data: {
              checkedOutAt: checkoutDate,
              durationMinutes,
            },
          });
        } else {
          // No open session found, this shouldn't happen but log it
          console.warn(`Check-out without check-in for user ${userId}, attendance ${attendance.id}`);
        }
      }

      // Recalculate attendance status based on all sessions
      const allSessions = await tx.attendanceSession.findMany({
        where: {
          attendanceId: attendance.id,
        },
        orderBy: {
          checkedInAt: 'asc',
        },
      });

      if (allSessions.length > 0) {
        const firstSession = allSessions[0];
        const lastSession = allSessions[allSessions.length - 1];

        // Calculate time differences
        const timeDiffs = calculateTimeDifferences(
          orbat.startTime,
          orbat.endTime,
          firstSession.checkedInAt,
          lastSession.checkedOutAt,
          orbat.eventDate
        );

        // Calculate total minutes present (sum of all completed sessions)
        const totalMinutesPresent = allSessions
          .filter(s => s.durationMinutes !== null)
          .reduce((sum, s) => sum + (s.durationMinutes || 0), 0);

        // Determine if user never checked in
        const hasCheckedIn = allSessions.length > 0;

        // Calculate status
        const calculatedStatus = calculateAttendanceStatus(
          hasCheckedIn,
          timeDiffs.minutesLate,
          timeDiffs.minutesGoneEarly,
          timeDiffs.totalMinutesMissed,
          false // Not manually marked absent
        );

        // Update attendance with calculated values
        await tx.attendance.update({
          where: { id: attendance.id },
          data: {
            status: calculatedStatus,
            minutesLate: timeDiffs.minutesLate,
            minutesGoneEarly: timeDiffs.minutesGoneEarly,
            totalMinutesMissed: timeDiffs.totalMinutesMissed,
            totalMinutesPresent,
          },
        });
      }

      // Return updated attendance
      return tx.attendance.findUnique({
        where: { id: attendance.id },
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
          sessions: {
            orderBy: {
              checkedInAt: 'asc',
            },
          },
        },
      });
    });

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    console.error('Error processing automation attendance:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
