import { attendanceRoute } from '@/lib/api/attendance';
import { backfillAttendanceEvents } from '@/lib/api/attendance-automation';
export async function POST(request: Request) { return attendanceRoute(request, 'attendance:edit', (principal, audit) => backfillAttendanceEvents(request, principal, audit)); }
