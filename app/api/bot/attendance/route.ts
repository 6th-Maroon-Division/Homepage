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
    const { steamId, discordUserId, checkinTime, checkoutTime, orbatId, notes } = body;

    if (!steamId && !discordUserId) {
      return NextResponse.json(
        { error: 'At least one of steamId or discordUserId is required' },
        { status: 400 }
      );
    }

    if (!checkinTime && !checkoutTime) {
      return NextResponse.json(
        { error: 'At least one of checkinTime or checkoutTime must be provided' },
        { status: 400 }
      );
    }

    // Find user
    let user = null;
    if (steamId) {
      const auth = await prisma.authAccount.findUnique({
        where: { provider_providerUserId: { provider: 'steam', providerUserId: steamId } },
        include: { user: true },
      });
      if (auth) user = auth.user;
    }
    if (!user && discordUserId) {
      const auth = await prisma.authAccount.findUnique({
        where: { provider_providerUserId: { provider: 'discord', providerUserId: discordUserId } },
        include: { user: true },
      });
      if (auth) user = auth.user;
    }

    if (!user) {
      return NextResponse.json({ error: 'User not found', steamId, discordUserId }, { status: 404 });
    }

    const sessionDate = checkinTime ? new Date(checkinTime) : new Date(checkoutTime);
    const sessionDateOnly = new Date(sessionDate);
    sessionDateOnly.setUTCHours(0, 0, 0, 0);
    const sessionDateEnd = new Date(sessionDateOnly.getTime() + 86400000);

    // Find ORBAT
    let targetOrbat = null;
    if (orbatId) {
      targetOrbat = await prisma.orbat.findUnique({ where: { id: orbatId } });
    } else {
      targetOrbat = await prisma.orbat.findFirst({
        where: {
          OR: [
            { startsAtUtc: { gte: sessionDateOnly, lt: sessionDateEnd } },
            { startsAtUtc: null, eventDate: { gte: sessionDateOnly, lt: sessionDateEnd } },
          ],
        },
        orderBy: [
          { startsAtUtc: 'desc' },
          { createdAt: 'desc' },
        ],
      });
    }

    if (!targetOrbat) {
      return NextResponse.json({ error: 'No ORBAT found for this date', date: sessionDateOnly.toISOString() }, { status: 404 });
    }

    // Check signup
    const signup = await prisma.signup.findFirst({
      where: { userId: user.id, slot: { orbatId: targetOrbat.id } },
      include: { slot: { include: { orbat: true } } },
    });

    if (!signup) {
      return NextResponse.json({ error: 'User not signed up for this ORBAT', orbatId: targetOrbat.id }, { status: 400 });
    }

    const attendanceNote = await prisma.orbatAttendanceNote.findUnique({
      where: {
        orbatId_userId: {
          orbatId: targetOrbat.id,
          userId: user.id,
        },
      },
      select: {
        status: true,
        lateMinutes: true,
        leaveEarlyMinutes: true,
      },
    });

    const noteFlags = buildNoteFlags(attendanceNote ?? null);

    await prisma.$transaction(async (tx) => {
      let session = await tx.attendanceSession.findFirst({
        where: { userId: user.id, attendance: { signupId: signup.id } },
        orderBy: { timestamp: 'desc' },
      });

      const checkinDate = checkinTime ? new Date(checkinTime) : null;
      const checkoutDate = checkoutTime ? new Date(checkoutTime) : null;

      if (!session && checkinDate) {
        session = await tx.attendanceSession.create({
          data: { userId: user.id, attendanceId: null, checkedInAt: checkinDate, sessionDate: sessionDateOnly },
        });
      }

      if (checkinDate && (!session || !session.checkedInAt)) {
        await tx.attendanceSession.upsert({
          where: { id: session?.id ? session.id : 0 },
          create: { userId: user.id, attendanceId: null, checkedInAt: checkinDate, sessionDate: sessionDateOnly },
          update: { checkedInAt: checkinDate },
        });
      }

      if (checkoutDate && session && !session.checkedOutAt) {
        const durationMs = checkoutDate.getTime() - session.checkedInAt.getTime();
        const durationMinutes = Math.ceil(durationMs / 60000);
        await tx.attendanceSession.update({
          where: { id: session.id },
          data: { checkedOutAt: checkoutDate, durationMinutes },
        });
      }

      let attendance = await tx.attendance.findUnique({
        where: { signupId: signup.id },
      });

      if (!attendance) {
        attendance = await tx.attendance.create({
          data: { signupId: signup.id, orbatId: targetOrbat.id, userId: user.id, ...noteFlags },
        });
      }

      if (session && session.attendanceId === null) {
        await tx.attendanceSession.update({
          where: { id: session.id },
          data: { attendanceId: attendance.id },
        });
      }

      const allSessions = await tx.attendanceSession.findMany({
        where: { attendanceId: attendance.id },
        orderBy: { timestamp: 'asc' },
      });

      const hasCheckin = allSessions.some(s => s.checkedInAt);
      const totalMinutes = allSessions.reduce((sum, s) => sum + (s.durationMinutes || 0), 0);
      const status: 'present' | 'absent' | 'partial' | 'late' | 'gone_early' | 'no_show' = hasCheckin ? (totalMinutes >= 60 ? 'present' : 'partial') : 'absent';

      await tx.attendance.update({
        where: { id: attendance.id },
        data: {
          status,
          totalMinutesPresent: totalMinutes,
          notes: notes ? notes : null,
          ...noteFlags,
          updatedAt: new Date(),
        },
      });

      await tx.attendanceLog.create({
        data: {
          attendanceId: attendance.id,
          action: 'bot_submitted',
          source: 'bot',
          newValue: { status, totalMinutesPresent: totalMinutes, notes: notes ? notes : null, discordUserId },
        },
      });
    });

    return NextResponse.json({
      success: true,
      message: 'Attendance recorded',
      userId: user.id,
      username: user.username,
      orbatId: targetOrbat.id,
      orbatName: targetOrbat.name,
    });
  } catch (error) {
    console.error('Bot attendance error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
