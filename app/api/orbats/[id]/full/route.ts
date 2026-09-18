import { handlePublicApiRequest } from '@/lib/api/handler';
import { apiError, apiSuccess } from '@/lib/api/response';
import { parsePositiveId } from '@/lib/api/validation';
import { writeApiAudit } from '@/lib/api/audit';
import { prisma } from '@/lib/prisma';
import { getPublicOrbat } from '@/lib/api/public-orbat';
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  return handlePublicApiRequest(request, async (principal, audit) => {
    const id = parsePositiveId((await context.params).id);
    if (!id || id > 2147483647) return apiError(400, 'invalid_request', 'Invalid ORBAT id.');
    if (new URL(request.url).searchParams.size) return apiError(400, 'invalid_request', 'This endpoint does not accept query parameters.');
    const data = await getPublicOrbat(id);
    if (!data) return apiError(404, 'not_found', 'ORBAT not found.');
    const displayedUserIds = [...data.squads.flatMap(squad => squad.slots.flatMap(slot => slot.signups.flatMap(signup => signup.user ? [signup.user.id] : []))), ...data.attendanceNotes.map(note => note.userId)];
    const targetUserIds = [...new Set(displayedUserIds)].filter(userId => principal?.kind !== 'user' || principal.userId !== userId);
    if (targetUserIds.length) await writeApiAudit(prisma, audit, { action: 'user_data.read', resource: 'orbat', resourceId: String(id), targetUserIds, outcome: 'success' });
    return apiSuccess(data);
  });
}
