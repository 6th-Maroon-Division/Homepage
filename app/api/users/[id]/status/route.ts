import { handleApiRequest } from '@/lib/api/handler';
import { apiError, apiSuccess } from '@/lib/api/response';
import { readJsonBody } from '@/lib/api/request';
import { parsePositiveId } from '@/lib/api/validation';
import { parseUserStatus, updateUserStatuses } from '@/lib/api/user-status';
type Context = { params: Promise<{ id: string }> };
export async function PATCH(request: Request, context: Context) {
  return handleApiRequest(request, 'user:manage', async (principal, audit) => {
    const { id } = await context.params;
    const userId = id === 'me' && principal.kind === 'user' ? principal.userId : parsePositiveId(id);
    if (!userId || userId > 2147483647) return apiError(400, 'invalid_request', 'Use a positive user id; me requires a user session.');
    const parsed = parseUserStatus(await readJsonBody(request));
    if (parsed.error) return parsed.error;
    const result = await updateUserStatuses(principal, audit, [{ userId, ...parsed.data }]);
    return result.error ? result.error : apiSuccess(result.data![0]);
  });
}
