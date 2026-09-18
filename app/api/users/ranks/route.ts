import { validateQueryParameters } from '@/lib/api/validation';
import { handleApiRequest } from '@/lib/api/handler';
import { apiError, apiSuccess } from '@/lib/api/response';
import { readJsonBody } from '@/lib/api/request';
import { parseBulkUserRankMutation, updateUserRanks } from '@/lib/api/user-rank-mutations';
export async function PATCH(request: Request) {
  return handleApiRequest(request, 'rank:manage_promotions', async (principal, audit) => {
    const queryError = validateQueryParameters(request, []);
    if (queryError) return apiError(400, 'invalid_request', queryError);
    const parsed = parseBulkUserRankMutation(await readJsonBody(request));
    if (parsed.error) return parsed.error;
    const result = await updateUserRanks(principal, audit, parsed.data, true);
    return result.error ? result.error : apiSuccess(result.data);
  });
}
