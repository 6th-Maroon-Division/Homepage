import { publicAttendanceRoute, attendanceStats } from '@/lib/api/attendance';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) { return publicAttendanceRoute(request, async (principal, audit) => attendanceStats(request, principal, audit, (await context.params).id)); }
