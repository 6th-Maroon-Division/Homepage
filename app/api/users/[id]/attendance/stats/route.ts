import { NextRequest, NextResponse } from 'next/server';
import { getUserAttendanceStats } from '@/lib/attendance-stats';

// GET /api/users/[id]/attendance/stats
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const searchParams = request.nextUrl.searchParams;
    const days = parseInt(searchParams.get('days') || '30');

    const stats = await getUserAttendanceStats(parseInt(id), days);

    return NextResponse.json(stats);
  } catch (error) {
    console.error('Error fetching attendance stats:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
