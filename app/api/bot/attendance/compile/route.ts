import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

function validateBotToken(request: NextRequest): boolean {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return false;
  const token = authHeader.substring(7);
  return token === process.env.BOT_API_TOKEN;
}

export async function POST(request: NextRequest) {
  try {
    if (!validateBotToken(request)) {
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

    // Build ORBAT start and end DateTime
    const orbatDate = orbat.eventDate ? new Date(orbat.eventDate) : null;
    let orbatStart = orbatDate;
    let orbatEnd = orbatDate;

    if (orbatDate && orbat.startTime) {
      const [hours, minutes] = orbat.startTime.split(':');
      orbatStart = new Date(orbatDate);
      orbatStart.setHours(parseInt(hours), parseInt(minutes), 0, 0);
    }

    if (orbatDate && orbat.endTime) {
      const [hours, minutes] = orbat.endTime.split(':');
      orbatEnd = new Date(orbatDate);
      orbatEnd.setHours(parseInt(hours), parseInt(minutes), 0, 0);
    }

    if (!orbatStart || !orbatEnd) {
      return NextResponse.json(
        { error: 'ORBAT must have eventDate, startTime, and endTime to compile attendance' },
        { status: 400 }
      );
    }

    // Find all events within ORBAT timeframe
    const events = await prisma.attendanceEvent.findMany({
      where: {
        eventTime: {
          gte: orbatStart,
          lte: orbatEnd,
        },
      },
      orderBy: { eventTime: 'asc' },
    });

    // Group events by user
    const userEvents: Record<number, { joins: Date[]; leaves: Date[] }> = {};
    for (const event of events) {
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

      // Simple calculation: if user has at least one join, they're present
      // More sophisticated: pair join/leave events and sum durations
      if (joins.length > 0) {
        // If there are paired join/leave events, calculate exact duration
        const pairedEvents = [];
        let joinIndex = 0;
        let leaveIndex = 0;
        
        while (joinIndex < joins.length && leaveIndex < leaves.length) {
          pairedEvents.push({ type: 'join' as const, time: joins[joinIndex] });
          joinIndex++;
          pairedEvents.push({ type: 'leave' as const, time: leaves[leaveIndex] });
          leaveIndex++;
        }
        
        // Add any remaining events
        while (joinIndex < joins.length) {
          pairedEvents.push({ type: 'join' as const, time: joins[joinIndex] });
          joinIndex++;
        }
        while (leaveIndex < leaves.length) {
          pairedEvents.push({ type: 'leave' as const, time: leaves[leaveIndex] });
          leaveIndex++;
        }
        
        // Calculate duration from paired events
        let checkedInAt: Date | null = null;
        for (const event of pairedEvents) {
          if (event.type === 'join' && !checkedInAt) {
            checkedInAt = event.time;
          } else if (event.type === 'leave' && checkedInAt) {
            const durationMs = event.time.getTime() - checkedInAt.getTime();
            totalMinutesPresent += Math.floor(durationMs / 60000);
            checkedInAt = null;
          }
        }
        
        // If still checked in at ORBAT end, count remaining time
        if (checkedInAt) {
          const durationMs = orbatEnd.getTime() - checkedInAt.getTime();
          totalMinutesPresent += Math.floor(durationMs / 60000);
        }
      }

      // Determine status
      const status: 'present' | 'absent' | 'partial' | 'late' | 'gone_early' | 'no_show' = 
        totalMinutesPresent >= 60 ? 'present' :
        totalMinutesPresent > 0 ? 'partial' :
        joins.length === 0 ? 'no_show' : 'absent';

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
        },
        update: {
          status: status as 'present' | 'absent' | 'partial' | 'late' | 'gone_early' | 'no_show',
          totalMinutesPresent,
          updatedAt: new Date(),
        },
      });

      compiledAttendance.push({
        userId: userIdNum,
        username: signup.user.username,
        status,
        totalMinutesPresent,
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
