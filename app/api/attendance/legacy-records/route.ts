import { attendanceRoute } from '@/lib/api/attendance';
import { listLegacyAttendance } from '@/lib/api/legacy-attendance';
export async function GET(request: Request) { return attendanceRoute(request, 'attendance:edit', (principal, audit) => listLegacyAttendance(request, principal, audit)); }
