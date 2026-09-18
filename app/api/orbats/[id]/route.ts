import { handleApiRequest } from '@/lib/api/handler';
import { apiError, apiSuccess } from '@/lib/api/response';
import { parsePositiveId } from '@/lib/api/validation';
import { readJsonBody } from '@/lib/api/request';
import { getOrbatEditor, mutateOrbat, parseOrbatPatch } from '@/lib/api/orbat-editor';
type Context = { params: Promise<{ id: string }> };
async function target(request: Request, context: Context) {
  const id = parsePositiveId((await context.params).id);
  return id === null || id > 2147483647 || [...new URL(request.url).searchParams].length ? null : id;
}
export async function GET(request: Request, context: Context) {
  return handleApiRequest(request, 'orbat:edit', async () => {
    const id = await target(request, context);
    if (id === null) return apiError(400, 'invalid_request', 'Provide a valid operation ID without query parameters.');
    const data = await getOrbatEditor(id);
    return data ? apiSuccess(data) : apiError(404, 'not_found', 'Operation not found.');
  });
}
export async function PATCH(request: Request, context: Context) {
  return handleApiRequest(request, 'orbat:edit', async (principal, audit) => {
    const id = await target(request, context);
    if (id === null) return apiError(400, 'invalid_request', 'Provide a valid operation ID without query parameters.');
    const parsed = parseOrbatPatch(await readJsonBody(request));
    if (parsed.error) return parsed.error;
    const result = await mutateOrbat(principal, audit, id, parsed.data);
    return result.error ?? apiSuccess(result.data);
  });
}
export async function DELETE(request: Request, context: Context) {
  return handleApiRequest(request, 'orbat:delete', async (principal, audit) => {
    const id = await target(request, context);
    if (id === null) return apiError(400, 'invalid_request', 'Provide a valid operation ID without query parameters.');
    const result = await mutateOrbat(principal, audit, id, null);
    return result.error ?? apiSuccess(result.data);
  });
}
