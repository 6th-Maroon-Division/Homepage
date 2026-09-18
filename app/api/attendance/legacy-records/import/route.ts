import { attendanceRoute } from '@/lib/api/attendance';
import { importLegacyAttendance } from '@/lib/api/legacy-attendance';
export async function POST(request: Request) { return attendanceRoute(request, 'attendance:edit', (principal, audit) => importLegacyAttendance(request, principal, audit)); }
