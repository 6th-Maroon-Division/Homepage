import { validateQueryParameters, parseCursorPagination } from '@/lib/api/validation';
import { prisma } from '@/lib/prisma';
import { handleApiRequest } from '@/lib/api/handler';
import { apiError, apiSuccess } from '@/lib/api/response';
import { readJsonBody } from '@/lib/api/request';
import { parseRadioFrequencyBody, radioFrequencySnapshot, radioMutationError } from '@/lib/api/radio-frequencies';
import { writeApiAudit } from '@/lib/api/audit';

export async function GET(request: Request) {
  return handleApiRequest(request, undefined, async () => {
    const queryError = validateQueryParameters(request, ['limit', 'cursor']);
    if (queryError) return apiError(400, 'invalid_request', queryError);
    const pagination = parseCursorPagination(new URL(request.url).searchParams, { defaultLimit: 50, maxLimit: 100 });
    if (pagination.error !== undefined) return apiError(400, 'invalid_request', pagination.error);
    const { limit, cursor } = pagination.data;
    const rows = await prisma.radioFrequency.findMany({ where: cursor ? { id: { gt: cursor } } : {}, orderBy: { id: 'asc' }, take: limit + 1 });
    const data = rows.slice(0, limit);
    return apiSuccess(data, { meta: { limit, nextCursor: rows.length > limit ? String(data.at(-1)!.id) : null } });
  });
}

export async function POST(request: Request) {
  return handleApiRequest(request, 'orbat:edit', async (_principal, audit) => {
    const queryError = validateQueryParameters(request, []);
    if (queryError) return apiError(400, 'invalid_request', queryError);
    const parsed = parseRadioFrequencyBody(await readJsonBody(request), true);
    if (parsed.error) return parsed.error;
    try {
      const created = await prisma.$transaction(async tx => {
        const frequency = await tx.radioFrequency.create({ data: { ...parsed.data, frequency: parsed.data.frequency!, type: parsed.data.type! } });
        await writeApiAudit(tx, audit, { action: 'radio_frequency.created', resource: 'radio_frequency', resourceId: String(frequency.id), outcome: 'success', after: radioFrequencySnapshot(frequency) });
        return frequency;
      });
      return apiSuccess(created, { status: 201 });
    } catch (error) {
      return radioMutationError(error);
    }
  });
}
