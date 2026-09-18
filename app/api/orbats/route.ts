import { getPublicOrbatList } from '@/lib/api/orbat-list';
import { handleApiRequest } from '@/lib/api/handler';
import { readJsonBody } from '@/lib/api/request';
import { apiError, apiSuccess } from '@/lib/api/response';
import { createOrbat, parseOrbatCreate } from '@/lib/api/orbat-create';

export async function GET(request: Request) {
  return getPublicOrbatList(request);
}

export async function POST(request: Request) {
  return handleApiRequest(request, 'orbat:create', async (principal, context) => {
    if ([...new URL(request.url).searchParams].length) return apiError(400, 'validation_failed', 'Operation creation does not accept query parameters.');
    const parsed = parseOrbatCreate(await readJsonBody(request));
    if (parsed.error) return parsed.error;
    const result = await createOrbat(principal, context, parsed.data);
    return result.error ?? apiSuccess(result.data, { status: 201 });
  });
}
