import { validateQueryParameters } from '@/lib/api/validation';
import { handleApiRequest } from '@/lib/api/handler';
import { apiError, apiSuccess } from '@/lib/api/response';
import { readJsonBody } from '@/lib/api/request';
import { parseBulkUserStatus, updateUserStatuses } from '@/lib/api/user-status';
export async function PATCH(request: Request) {
  return handleApiRequest(request, 'user:manage', async (principal, audit) => {
    const queryError = validateQueryParameters(request, []);
    if (queryError) return apiError(400, 'invalid_request', queryError);
    const parsed = parseBulkUserStatus(await readJsonBody(request));
    if (parsed.error) return parsed.error;
    const result = await updateUserStatuses(principal, audit, parsed.data);
    return result.error ? result.error : apiSuccess(result.data);
  });
}
