import { prisma } from '@/lib/prisma';
import { handleApiRequest } from '@/lib/api/handler';
import { apiError, apiSuccess } from '@/lib/api/response';
import { readJsonBody } from '@/lib/api/request';
import { parsePositiveId } from '@/lib/api/validation';
import { writeApiAudit } from '@/lib/api/audit';
import { enrichRoleDefinitions, parseRoleDefinition, roleDatabaseError, validateRolePrerequisites } from '@/lib/api/role-definitions';
import { publishAdminCatalogEvent } from '@/lib/realtime/admin-catalog-events';

type Context = { params: Promise<{ id: string }> };
export async function PATCH(request: Request, context: Context) {
  return handleApiRequest(request, 'subslot:edit', async (principal, audit) => {
    const id = parsePositiveId((await context.params).id);
    if (id === null || id > 2147483647) return apiError(400, 'invalid_request', 'Invalid role definition id.');
    const parsed = parseRoleDefinition(await readJsonBody(request), false);
    if (parsed.error) return parsed.error;
    try {
      const result = await prisma.$transaction(async tx => {
        const before = await tx.squadRole.findUnique({ where: { id } });
        if (!before) return { error: apiError(404, 'not_found', 'Role definition not found.') };
        if (parsed.data.name !== undefined && await tx.squadRole.findFirst({ where: { name: parsed.data.name, id: { not: id } } })) return { error: apiError(409, 'conflict', 'A role definition with this name already exists.') };
        const invalid = await validateRolePrerequisites(tx, parsed.data);
        if (invalid) return { error: invalid };
        const after = await tx.squadRole.update({ where: { id }, data: parsed.data });
        const previous = Object.fromEntries(Object.keys(parsed.data).map(key => [key, before[key as keyof typeof before]]));
        await writeApiAudit(tx, audit, { action: 'role_definition.updated', resource: 'role_definition', resourceId: String(id), outcome: 'success', before: previous, after: parsed.data });
        return { data: (await enrichRoleDefinitions(tx, [after]))[0] };
      });
      if (result.error) return result.error;
      publishAdminCatalogEvent({ type: 'role-definition.changed', actorUserId: principal.kind === 'user' ? principal.userId : undefined, payload: { action: 'updated', roleDefinitionId: id } });
      return apiSuccess(result.data);
    } catch (error) { return roleDatabaseError(error); }
  });
}

export async function DELETE(request: Request, context: Context) {
  return handleApiRequest(request, 'subslot:delete', async (principal, audit) => {
    const id = parsePositiveId((await context.params).id);
    if (id === null || id > 2147483647) return apiError(400, 'invalid_request', 'Invalid role definition id.');
    try {
      const error = await prisma.$transaction(async tx => {
        const before = await tx.squadRole.findUnique({ where: { id } });
        if (!before) return apiError(404, 'not_found', 'Role definition not found.');
        if (await tx.slot.count({ where: { squadRoleId: id } })) return apiError(409, 'conflict', 'Cannot delete a role definition used by ORBAT slots.');
        await tx.squadRole.delete({ where: { id } });
        await writeApiAudit(tx, audit, { action: 'role_definition.deleted', resource: 'role_definition', resourceId: String(id), outcome: 'success', before: { name: before.name, requiredTrainingIds: before.requiredTrainingIds, requiredRankIds: before.requiredRankIds, isRetired: before.isRetired } });
        return null;
      });
      if (error) return error;
      publishAdminCatalogEvent({ type: 'role-definition.changed', actorUserId: principal.kind === 'user' ? principal.userId : undefined, payload: { action: 'deleted', roleDefinitionId: id } });
      return apiSuccess(null);
    } catch (error) { return roleDatabaseError(error); }
  });
}
