import { validateQueryParameters, parseCursorPagination } from '@/lib/api/validation';
import { prisma } from '@/lib/prisma';
import { handleApiRequest } from '@/lib/api/handler';
import { apiError, apiSuccess } from '@/lib/api/response';
import { readJsonBody } from '@/lib/api/request';
import { hasApiPermission } from '@/lib/api/permissions';
import { writeApiAudit } from '@/lib/api/audit';
import { enrichRoleDefinitions, parseRoleDefinition, roleDatabaseError, roleReadPermissions, validateRolePrerequisites } from '@/lib/api/role-definitions';
import { publishAdminCatalogEvent } from '@/lib/realtime/admin-catalog-events';

export async function GET(request: Request) {
  return handleApiRequest(request, undefined, async principal => {
    const queryError = validateQueryParameters(request, ['limit', 'cursor']);
    if (queryError) return apiError(400, 'invalid_request', queryError);
    if (!roleReadPermissions.some(permission => hasApiPermission(principal.permissions, permission))) return apiError(403, 'forbidden', 'Requires access to role definitions, templates, or ORBAT management.');
    const pagination = parseCursorPagination(new URL(request.url).searchParams, { defaultLimit: 50, maxLimit: 100 });
    if (pagination.error !== undefined) return apiError(400, 'invalid_request', pagination.error);
    const { limit, cursor } = pagination.data;
    const rows = await prisma.squadRole.findMany({ where: cursor ? { id: { gt: cursor } } : {}, orderBy: { id: 'asc' }, take: limit + 1 });
    const page = rows.slice(0, limit);
    return apiSuccess(await enrichRoleDefinitions(prisma, page), { meta: { limit, nextCursor: rows.length > limit ? String(page.at(-1)!.id) : null } });
  });
}

export async function POST(request: Request) {
  return handleApiRequest(request, 'subslot:create', async (principal, audit) => {
    const queryError = validateQueryParameters(request, []);
    if (queryError) return apiError(400, 'invalid_request', queryError);
    const parsed = parseRoleDefinition(await readJsonBody(request), true);
    if (parsed.error) return parsed.error;
    try {
      const result = await prisma.$transaction(async tx => {
        if (await tx.squadRole.findFirst({ where: { name: parsed.data.name } })) return { error: apiError(409, 'conflict', 'A role definition with this name already exists.') };
        const invalid = await validateRolePrerequisites(tx, parsed.data);
        if (invalid) return { error: invalid };
        const created = await tx.squadRole.create({ data: { ...parsed.data, name: parsed.data.name! } });
        await writeApiAudit(tx, audit, { action: 'role_definition.created', resource: 'role_definition', resourceId: String(created.id), outcome: 'success', after: parsed.data });
        return { data: (await enrichRoleDefinitions(tx, [created]))[0] };
      });
      if (result.error) return result.error;
      publishAdminCatalogEvent({ type: 'role-definition.changed', actorUserId: principal.kind === 'user' ? principal.userId : undefined, payload: { action: 'created', roleDefinitionId: result.data!.id } });
      return apiSuccess(result.data, { status: 201 });
    } catch (error) { return roleDatabaseError(error); }
  });
}
