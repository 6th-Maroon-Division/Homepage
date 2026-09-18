import { attendanceRoute } from '@/lib/api/attendance';
import { listLegacyUsers, mapLegacyUsers } from '@/lib/api/legacy-users';
export async function GET(request: Request) { return attendanceRoute(request, 'attendance:view', (principal,audit) => listLegacyUsers(request,principal,audit)); }
export async function PATCH(request: Request) { return attendanceRoute(request, 'system:super_admin', (principal,audit) => mapLegacyUsers(request,principal,audit)); }
