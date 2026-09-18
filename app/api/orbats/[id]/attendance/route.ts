import { attendanceRoute, attendanceId, listAttendance, mutateAttendance } from '@/lib/api/attendance';
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) { return attendanceRoute(request, 'attendance:view', async (principal, audit) => listAttendance(request, principal, audit, { orbatId: attendanceId((await context.params).id) })); }
export async function POST(request: Request, context: Context) { return attendanceRoute(request, 'attendance:edit', async (principal, audit) => mutateAttendance(request, principal, audit, 'POST', attendanceId((await context.params).id))); }
