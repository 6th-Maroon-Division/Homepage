import { attendanceId, attendanceRoute } from '@/lib/api/attendance';
import { importAttendance } from '@/lib/api/attendance-import';
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return attendanceRoute(request, 'attendance:edit', async (principal, audit) => importAttendance(request, principal, audit, attendanceId((await context.params).id)));
}
