import { attendanceRoute } from '@/lib/api/attendance';
import { applyLegacyUsers } from '@/lib/api/legacy-users';
export async function POST(request: Request) { return attendanceRoute(request, 'system:super_admin', (principal,audit) => applyLegacyUsers(request,principal,audit)); }
