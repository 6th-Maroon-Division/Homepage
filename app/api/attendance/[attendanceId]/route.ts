import { attendanceRoute, attendanceId, getAttendance, mutateAttendance } from '@/lib/api/attendance';
type Context = { params: Promise<{ attendanceId: string }> };
export async function GET(request: Request, context: Context) { return attendanceRoute(request, 'attendance:view', async (principal, audit) => getAttendance(request, principal, audit, attendanceId((await context.params).attendanceId))); }
export async function PATCH(request: Request, context: Context) { return attendanceRoute(request, 'attendance:edit', async (principal, audit) => mutateAttendance(request, principal, audit, 'PATCH', attendanceId((await context.params).attendanceId))); }
export async function DELETE(request: Request, context: Context) { return attendanceRoute(request, 'attendance:edit', async (principal, audit) => mutateAttendance(request, principal, audit, 'DELETE', attendanceId((await context.params).attendanceId))); }
