import { attendanceRoute } from '@/lib/api/attendance';
import { importLegacyUsers } from '@/lib/api/legacy-users';
export async function POST(request: Request) { return attendanceRoute(request, 'attendance:edit', (principal,audit) => importLegacyUsers(request,principal,audit)); }
