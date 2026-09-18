import { attendanceRoute } from '@/lib/api/attendance';
import { ingestAttendanceEvent } from '@/lib/api/attendance-automation';
export async function POST(request: Request) { return attendanceRoute(request, 'attendance:edit', (principal, audit) => ingestAttendanceEvent(request, principal, audit)); }
