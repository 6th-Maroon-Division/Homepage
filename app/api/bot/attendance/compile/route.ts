import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { validateBotTokenLegacy } from '@/lib/bot-token-validation';

type NoteFlagState = {
  notedAbsent: boolean;
  notedLateEarly: boolean;
  notedUnsure: boolean;
};

function buildNoteFlags(note: { status: 'absent' | 'unsure' | 'late_unsure'; lateMinutes: number | null; leaveEarlyMinutes: number | null } | null): NoteFlagState {
  if (!note) {
    return {
      notedAbsent: false,
      notedLateEarly: false,
      notedUnsure: false,
    };
  }

  return {
    notedAbsent: note.status === 'absent',
    notedLateEarly:
      note.status === 'late_unsure' ||
      (note.lateMinutes ?? 0) > 0 ||
      (note.leaveEarlyMinutes ?? 0) > 0,
    notedUnsure: note.status === 'unsure' || note.status === 'late_unsure',
  };
}

function validateBotToken(request: NextRequest): Promise<boolean> {
  return validateBotTokenLegacy(request);
}

export async function POST(request: NextRequest) {
  try {
    if (!(await validateBotToken(request))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { orbatId } = body;

    if (!orbatId) {
      return NextResponse.json(
        { error: 'orbatId is required' },
        { status: 400 }
      );
    }

    // Get ORBAT details
    const orbat = await prisma.orbat.findUnique({
      where: { id: orbatId },
      include: {
        squads: {
          include: {
            slots: {
              include: {
                signups: {
                  include: { user: true },
                },
              },
            },
          },
        },
      },
    });

    if (!orbat) {
      return NextResponse.json(
        { error: 'ORBAT not found', orbatId },
        { status: 404 }
      );
    }

    // Prefer canonical UTC schedule fields; fallback to legacy fields for older ORBAT records.
    const orbatDate = orbat.eventDate ? new Date(orbat.eventDate) : null;
    const startsAtUtc = orbat.startsAtUtc ? new Date(orbat.startsAtUtc) : null;
    const endsAtUtc = orbat.endsAtUtc ? new Date(orbat.endsAtUtc) : null;

    let orbatStart = startsAtUtc || orbatDate;
    let orbatEnd = endsAtUtc || orbatDate;

    if (!startsAtUtc && orbatDate && orbat.startTime) {
      const [hours, minutes] = orbat.startTime.split(':');
      orbatStart = new Date(orbatDate);
      orbatStart.setUTCHours(parseInt(hours, 10), parseInt(minutes, 10), 0, 0);
    }

    if (!endsAtUtc && orbatDate && orbat.endTime) {
      const [hours, minutes] = orbat.endTime.split(':');
      orbatEnd = new Date(orbatDate);
      orbatEnd.setUTCHours(parseInt(hours, 10), parseInt(minutes, 10), 0, 0);
    }

    if (!orbatStart || !orbatEnd) {
      return NextResponse.json(
        { error: 'ORBAT must have eventDate, startTime, and endTime to compile attendance' },
        { status: 400 }
      );
    }

    const operationDurationMinutes = Math.max(
      0,
      Math.floor((orbatEnd.getTime() - orbatStart.getTime()) / 60000)
    );

    // Include nearby events so early joins and late leaves can be clamped to the ORBAT window.
    const boundaryBufferMs = 6 * 60 * 60 * 1000;
    const queryStart = new Date(orbatStart.getTime() - boundaryBufferMs);
    const queryEnd = new Date(orbatEnd.getTime() + boundaryBufferMs);

    // Find events around ORBAT timeframe; duration is clamped to operation bounds below.
    const events = await prisma.attendanceEvent.findMany({
      where: {
        eventTime: {
          gte: queryStart,
          lte: queryEnd,
        },
      },
      orderBy: { eventTime: 'asc' },
    });

    const attendanceNotes = await prisma.orbatAttendanceNote.findMany({
      where: { orbatId: orbat.id },
      select: {
        userId: true,
        status: true,
        lateMinutes: true,
        leaveEarlyMinutes: true,
      },
    });

    const noteByUserId = new Map(attendanceNotes.map((note) => [note.userId, note]));

    // Group events by user (only include events with a userId)
    const userEvents: Record<number, { joins: Date[]; leaves: Date[] }> = {};
    for (const event of events) {
      // Skip events that haven't been matched to a user yet (processed = false, userId = null)
      if (!event.userId) continue;
      
      if (!userEvents[event.userId]) {
        userEvents[event.userId] = { joins: [], leaves: [] };
      }
      if (event.isJoin) {
        userEvents[event.userId].joins.push(event.eventTime);
      } else {
        userEvents[event.userId].leaves.push(event.eventTime);
      }
    }

    // Compile attendance for each user
    const compiledAttendance = [];
    for (const [userId, { joins, leaves }] of Object.entries(userEvents)) {
      const userIdNum = parseInt(userId);

      // Find signed up users for this ORBAT
      const signup = await prisma.signup.findFirst({
        where: {
          userId: userIdNum,
          slot: { orbatId: orbat.id },
        },
        include: { slot: true, user: true },
      });

      if (!signup) {
        console.warn(`User ${userIdNum} has events but no signup for ORBAT ${orbat.id}`);
        continue;
      }

      // Calculate total minutes present
      let totalMinutesPresent = 0;
      let minutesLate = 0;
      let minutesGoneEarly = 0;
      let totalMinutesMissed = 0;

      // Start-only session should count as full presence for the operation window.
      if (joins.length > 0 && leaves.length === 0) {
        totalMinutesPresent = operationDurationMinutes;
      } else if (joins.length > 0) {
        const timeline = [
          ...joins.map((time) => ({ type: 'join' as const, time })),
          ...leaves.map((time) => ({ type: 'leave' as const, time })),
        ].sort((a, b) => a.time.getTime() - b.time.getTime());

        let checkedInAt: Date | null = null;
        for (const event of timeline) {
          if (event.type === 'join' && !checkedInAt) {
            checkedInAt = event.time;
          } else if (event.type === 'leave' && checkedInAt) {
            const segmentStartMs = Math.max(checkedInAt.getTime(), orbatStart.getTime());
            const segmentEndMs = Math.min(event.time.getTime(), orbatEnd.getTime());

            if (segmentEndMs > segmentStartMs) {
              totalMinutesPresent += Math.floor((segmentEndMs - segmentStartMs) / 60000);
            }

            checkedInAt = null;
          }
        }

        // If still checked in at ORBAT end, count remaining clamped time.
        if (checkedInAt) {
          const segmentStartMs = Math.max(checkedInAt.getTime(), orbatStart.getTime());
          const segmentEndMs = orbatEnd.getTime();
          if (segmentEndMs > segmentStartMs) {
            totalMinutesPresent += Math.floor((segmentEndMs - segmentStartMs) / 60000);
          }
        }

        const firstJoin = joins[0];
        const lastLeave = leaves.length > 0 ? leaves[leaves.length - 1] : null;

        if (firstJoin && firstJoin > orbatStart) {
          minutesLate = Math.min(
            60,
            Math.ceil((firstJoin.getTime() - orbatStart.getTime()) / 60000)
          );
        }

        if (lastLeave && lastLeave < orbatEnd) {
          minutesGoneEarly = Math.min(
            60,
            Math.ceil((orbatEnd.getTime() - lastLeave.getTime()) / 60000)
          );
        }
      }

      totalMinutesMissed = minutesLate + minutesGoneEarly;

      // Determine status
      const status: 'present' | 'absent' | 'partial' | 'late' | 'gone_early' | 'no_show' = 
        joins.length === 0 ? 'no_show' :
        minutesLate > 0 && minutesGoneEarly > 0 ? 'partial' :
        minutesLate > 0 ? 'late' :
        minutesGoneEarly > 0 ? 'gone_early' :
        totalMinutesPresent > 0 ? 'present' : 'absent';

      const noteFlags = buildNoteFlags(noteByUserId.get(userIdNum) ?? null);

      // Create or update attendance record
      await prisma.attendance.upsert({
        where: {
          signupId: signup.id,
        },
        create: {
          signupId: signup.id,
          orbatId: orbat.id,
          userId: userIdNum,
          status: status as 'present' | 'absent' | 'partial' | 'late' | 'gone_early' | 'no_show',
          totalMinutesPresent,
          minutesLate,
          minutesGoneEarly,
          totalMinutesMissed,
          ...noteFlags,
        },
        update: {
          status: status as 'present' | 'absent' | 'partial' | 'late' | 'gone_early' | 'no_show',
          totalMinutesPresent,
          minutesLate,
          minutesGoneEarly,
          totalMinutesMissed,
          ...noteFlags,
          updatedAt: new Date(),
        },
      });

      compiledAttendance.push({
        userId: userIdNum,
        username: signup.user.username,
        status,
        totalMinutesPresent,
        minutesLate,
        minutesGoneEarly,
        totalMinutesMissed,
        ...noteFlags,
        joinCount: joins.length,
        leaveCount: leaves.length,
      });
    }

    return NextResponse.json({
      success: true,
      orbatId: orbat.id,
      orbatName: orbat.name,
      eventDate: orbat.eventDate?.toISOString() || null,
      compiledCount: compiledAttendance.length,
      totalEventsProcessed: events.length,
      attendance: compiledAttendance,
    });
  } catch (error) {
    console.error('Bot attendance compile error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
