import { validateQueryParameters, parsePositiveId } from '@/lib/api/validation';
import { prisma } from '@/lib/prisma';
import { handleApiRequest } from '@/lib/api/handler';
import { apiError, apiSuccess } from '@/lib/api/response';
import { readJsonBody } from '@/lib/api/request';
import { parseRadioFrequencyBody, radioFrequencySnapshot, radioMutationError } from '@/lib/api/radio-frequencies';
import { writeApiAudit } from '@/lib/api/audit';

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context) {
  return handleApiRequest(request, 'orbat:edit', async (_principal, audit) => {
    const queryError = validateQueryParameters(request, []);
    if (queryError) return apiError(400, 'invalid_request', queryError);
    const id = parsePositiveId((await context.params).id);
    if (!id || id > 2147483647) return apiError(400, 'invalid_request', 'Invalid frequency id.');
    const parsed = parseRadioFrequencyBody(await readJsonBody(request), false);
    if (parsed.error) return parsed.error;
    try {
      return await prisma.$transaction(async tx => {
        const before = await tx.radioFrequency.findUnique({ where: { id } });
        if (!before) return apiError(404, 'not_found', 'Frequency not found.');
        const after = await tx.radioFrequency.update({ where: { id }, data: parsed.data });
        await writeApiAudit(tx, audit, { action: 'radio_frequency.updated', resource: 'radio_frequency', resourceId: String(id), outcome: 'success', before: radioFrequencySnapshot(before), after: radioFrequencySnapshot(after) });
        return apiSuccess(after);
      });
    } catch (error) {
      return radioMutationError(error);
    }
  });
}

export async function DELETE(request: Request, context: Context) {
  return handleApiRequest(request, 'orbat:delete', async (_principal, audit) => {
    const queryError = validateQueryParameters(request, []);
    if (queryError) return apiError(400, 'invalid_request', queryError);
    const id = parsePositiveId((await context.params).id);
    if (!id || id > 2147483647) return apiError(400, 'invalid_request', 'Invalid frequency id.');
    try {
      return await prisma.$transaction(async tx => {
        const before = await tx.radioFrequency.findUnique({ where: { id } });
        if (!before) return apiError(404, 'not_found', 'Frequency not found.');
        await tx.radioFrequency.delete({ where: { id } });
        await writeApiAudit(tx, audit, { action: 'radio_frequency.deleted', resource: 'radio_frequency', resourceId: String(id), outcome: 'success', before: radioFrequencySnapshot(before) });
        return apiSuccess(null);
      });
    } catch (error) { return radioMutationError(error); }
  });
}
