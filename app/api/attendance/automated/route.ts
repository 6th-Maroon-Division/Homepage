import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  calculateAttendanceStatus,
  calculateTimeDifferences,
  calculateTotalMinutesPresent,
  calculateSessionOverlap,
} from '@/lib/attendance';

/**
 * POST /api/attendance/automated
 * Record raw check-in or check-out event from Arma 3 server
 * 
 * The system stores all session data and links it to orbats the user is signed up for.
 * Times before orbat start or after orbat end are logged but not counted towards attendance.
 *
 * Expected body (either checkinTime OR checkoutTime or both):
 * {
 *   steamId: "76561198123456789",
 *   checkinTime?: "2026-01-15T18:30:00Z",
 *   checkoutTime?: "2026-01-15T23:30:00Z"
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { steamId, checkinTime, checkoutTime } = body;

    if (!steamId) {
      return NextResponse.json(
        { error: 'Missing required field: steamId' },
        { status: 400 }
      );
    }

    if (!checkinTime && !checkoutTime) {
      return NextResponse.json(
        { error: 'At least one of checkinTime or checkoutTime must be provided' },
        { status: 400 }
      );
    }

    // Find user by Steam ID
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
        { error: 'User with this Steam ID not found' },
        { status: 404 }
      );
    }

    const userId = authAccount.user.id;
    const checkinDate = checkinTime ? new Date(checkinTime) : null;
    const checkoutDate = checkoutTime ? new Date(checkoutTime) : null;

    // Determine session date (use checkin if available, else checkout)
    const sessionDate = checkinDate || checkoutDate;
    if (!sessionDate) {
      return NextResponse.json(
        { error: 'Invalid date in checkinTime or checkoutTime' },
        { status: 400 }
      );
    }

    const sessionDateOnly = new Date(sessionDate);
    sessionDateOnly.setHours(0, 0, 0, 0);

    // Create or update the session
    await prisma.$transaction(async (tx) => {
      // Find or create session for this user on this date
      let existingSession = await tx.attendanceSession.findFirst({
        where: {
          userId,
          sessionDate: {
            gte: sessionDateOnly,
            lt: new Date(
              sessionDateOnly.getTime() + 24 * 60 * 60 * 1000
            ),
          },
          attendanceId: null, // Only find unattached sessions
        },
        orderBy: {
          timestamp: 'desc',
        },
      });

      if (checkinTime) {
        if (existingSession && !existingSession.checkedOutAt) {
          // Update existing open session
          if (checkinDate) {
            await tx.attendanceSession.update({
              where: { id: existingSession.id },
              data: { checkedInAt: checkinDate },
            });
          }
        } else {
          // Create new session - attendanceId will be set later when we find/create attendance
          // For now, create a temporary session that will be linked when attendance is created
          if (checkinDate) {
            existingSession = await tx.attendanceSession.create({
              data: {
                userId,
                attendanceId: 0, // Placeholder - will be updated later
                checkedInAt: checkinDate,
                sessionDate: sessionDateOnly,
              },
            });
          }
        }
      }

      if (checkoutTime && existingSession && checkoutDate) {
        // Close the most recent open session
        const durationMs =
          checkoutDate.getTime() - existingSession.checkedInAt.getTime();
        const durationMinutes = Math.ceil(durationMs / (1000 * 60));

        await tx.attendanceSession.update({
          where: { id: existingSession.id },
          data: {
            checkedOutAt: checkoutDate,
            durationMinutes,
          },
        });
      }

      // Now find all orbats this user is signed up for on this session date
      const orbatSignups = await tx.signup.findMany({
        where: {
          userId,
          subslot: {
            slot: {
              orbat: {
                eventDate: {
                  gte: sessionDateOnly,
                  lt: new Date(
                    sessionDateOnly.getTime() + 24 * 60 * 60 * 1000
                  ),
                },
              },
            },
          },
        },
        include: {
          subslot: {
            include: {
              slot: {
                include: {
                  orbat: true,
                },
              },
            },
          },
        },
      });

      // For each orbat signup, create/update attendance record
      for (const signup of orbatSignups) {
        const orbat = signup.subslot.slot.orbat;

        // Find or create attendance record
        let attendance = await tx.attendance.findUnique({
          where: { signupId: signup.id },
          include: {
            sessions: {
              orderBy: { timestamp: 'asc' },
            },
          },
        });

        if (!attendance) {
          attendance = await tx.attendance.create({
            data: {
              signupId: signup.id,
              orbatId: orbat.id,
              userId,
            },
            include: {
              sessions: true,
            },
          });
        }

        // Fetch ALL sessions for this user on this date to calculate attendance
        const allSessions = await tx.attendanceSession.findMany({
          where: {
            userId,
            sessionDate: {
              gte: sessionDateOnly,
              lt: new Date(
                sessionDateOnly.getTime() + 24 * 60 * 60 * 1000
              ),
            },
          },
          orderBy: { timestamp: 'asc' },
        });

        // Calculate overlap for each session with this orbat's time window
        const countedSessions = [];
        let firstCountedCheckin: Date | null = null;
        let lastCountedCheckout: Date | null = null;
        let hasCheckinWithinWindow = false;

        for (const session of allSessions) {
          const overlap = calculateSessionOverlap(
            session.checkedInAt,
            session.checkedOutAt,
            orbat.startTime!,
            orbat.endTime!,
            orbat.eventDate!
          );

          if (overlap.isWithinWindow && overlap.countedCheckinAt) {
            countedSessions.push({
              countedCheckinAt: overlap.countedCheckinAt,
              countedCheckoutAt: overlap.countedCheckoutAt,
            });

            if (!firstCountedCheckin) {
              firstCountedCheckin = overlap.countedCheckinAt;
            }
            if (overlap.countedCheckoutAt) {
              lastCountedCheckout = overlap.countedCheckoutAt;
            }
            hasCheckinWithinWindow = true;
          }
        }

        // Calculate metrics based on counted (overlapped) times
        const timeDiffs = calculateTimeDifferences(
          orbat.startTime,
          orbat.endTime,
          firstCountedCheckin,
          lastCountedCheckout,
          orbat.eventDate
        );

        const totalMinutesPresent = calculateTotalMinutesPresent(countedSessions);

        // Calculate status
        const status = calculateAttendanceStatus(
          hasCheckinWithinWindow,
          timeDiffs.minutesLate,
          timeDiffs.minutesGoneEarly,
          timeDiffs.totalMinutesMissed,
          false
        );

        // Update attendance record
        await tx.attendance.update({
          where: { id: attendance.id },
          data: {
            status,
            minutesLate: timeDiffs.minutesLate,
            minutesGoneEarly: timeDiffs.minutesGoneEarly,
            totalMinutesMissed: timeDiffs.totalMinutesMissed,
            totalMinutesPresent,
            updatedAt: new Date(),
          },
        });

        // Create log entry
        await tx.attendanceLog.create({
          data: {
            attendanceId: attendance.id,
            action: 'time_updated',
            source: 'automated_system',
            changedById: null,
            newValue: {
              status,
              hasCheckinWithinOrbatWindow: hasCheckinWithinWindow,
              totalSessionsForDay: allSessions.length,
              countedSessionsForOrbat: countedSessions.length,
              minutesLate: timeDiffs.minutesLate,
              minutesGoneEarly: timeDiffs.minutesGoneEarly,
              totalMinutesMissed: timeDiffs.totalMinutesMissed,
              totalMinutesPresent,
            },
          },
        });
      }
    });

    return NextResponse.json(
      { success: true, message: 'Session recorded and attendance calculated' },
      { status: 200 }
    );
  } catch (error) {
    console.error('Error recording attendance:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
