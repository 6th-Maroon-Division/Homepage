import { attendanceRoute } from '@/lib/api/attendance';
import { recordAttendanceSession } from '@/lib/api/attendance-automation';
export async function POST(request: Request) { return attendanceRoute(request, 'attendance:edit', (principal, audit) => recordAttendanceSession(request, principal, audit)); }
