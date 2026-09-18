import { publicAttendanceRoute, publicAttendance } from '@/lib/api/attendance';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) { return publicAttendanceRoute(request, async (principal, audit) => publicAttendance(request, principal, audit, (await context.params).id)); }
