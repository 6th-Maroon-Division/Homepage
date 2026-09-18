import { attendanceRoute, attendanceId } from '@/lib/api/attendance';
import { compileAttendance } from '@/lib/api/attendance-automation';
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) { return attendanceRoute(request, 'attendance:edit', async (principal, audit) => compileAttendance(request, principal, audit, attendanceId((await context.params).id))); }
