import { NextRequest, NextResponse } from 'next/server';
import { getUserAttendanceRecords } from '@/lib/attendance-stats';

// GET /api/users/[id]/attendance
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const searchParams = request.nextUrl.searchParams;
    const days = parseInt(searchParams.get('days') || '30');
    const limit = parseInt(searchParams.get('limit') || '50');

    const records = await getUserAttendanceRecords(parseInt(id), days, limit);

    return NextResponse.json(records);
  } catch (error) {
    console.error('Error fetching attendance records:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
