import { prisma } from '@/lib/prisma';
import { handlePublicApiRequest } from '@/lib/api/handler';
import { apiError, apiSuccess } from '@/lib/api/response';
import { writeApiAudit } from '@/lib/api/audit';
import { getCalendarPage, parseCalendarPagination } from '@/lib/api/calendar';
export async function GET(request: Request) {
  return handlePublicApiRequest(request, async (principal, audit) => {
    const pagination = parseCalendarPagination(new URL(request.url).searchParams);
    if (pagination.error !== undefined) return apiError(400, 'invalid_request', pagination.error);
    const page = await getCalendarPage(principal, pagination.data);
    if (page.targetUserIds.length) await writeApiAudit(prisma, audit, { action: 'user_data.read', resource: 'calendar', targetUserIds: page.targetUserIds, outcome: 'success' });
    return apiSuccess(page.data, { meta: page.meta });
  });
}
