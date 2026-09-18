import { attendanceId, attendanceRoute } from '@/lib/api/attendance';
import { mapLegacyAttendance } from '@/lib/api/legacy-attendance';
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) { return attendanceRoute(request, 'system:super_admin', async (principal, audit) => mapLegacyAttendance(request, principal, audit, attendanceId((await context.params).id))); }
