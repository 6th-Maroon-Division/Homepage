import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { validateBotTokenLegacy } from '@/lib/bot-token-validation';
import { processAllUnprocessedEvents } from '@/lib/pending-events';

function validateBotToken(request: NextRequest): Promise<boolean> {
  return validateBotTokenLegacy(request);
}

// POST /api/bot/attendance/backfill
// Triggers a backfill pass that links pending raw attendance events to existing users.
export async function POST(request: NextRequest) {
  try {
    if (!(await validateBotToken(request))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const pendingBefore = await prisma.attendanceEvent.count({
      where: { processed: false },
    });

    const result = await processAllUnprocessedEvents();

    const pendingAfter = await prisma.attendanceEvent.count({
      where: { processed: false },
    });

    return NextResponse.json({
      success: true,
      message: 'Attendance raw-data backfill completed',
      linkedCount: result.totalProcessed,
      pendingBefore,
      pendingAfter,
    });
  } catch (error) {
    console.error('Bot attendance backfill error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
