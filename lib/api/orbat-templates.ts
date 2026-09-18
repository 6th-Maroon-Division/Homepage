import type { Prisma } from '@/generated/prisma/client';
import type { PermissionKey } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { normalizeTemplateForRead, normalizeTemplateSlots } from '@/lib/orbat-template';
import { publishAdminCatalogEvent } from '@/lib/realtime/admin-catalog-events';
import { handleApiRequest } from './handler';
import { hasApiPermission } from './permissions';
import { readJsonBody } from './request';
import { apiError, apiSuccess } from './response';
import { parseCursorPagination, parsePositiveId } from './validation';
import { writeApiAudit } from './audit';
import { parseOrbatCreate } from './orbat-create';

const texts = ['description', 'category', 'tagsJson', 'timezone', 'bluforCountry', 'bluforRelationship', 'opforCountry', 'opforRelationship', 'indepCountry', 'indepRelationship', 'iedThreat', 'civilianRelationship', 'rulesOfEngagement', 'airspace', 'inGameTimezone', 'operationDay', 'startTime', 'endTime'] as const;
const readPermissions: PermissionKey[] = ['template:create', 'template:edit', 'template:delete', 'orbat:create', 'orbat:edit'];
const include = { createdBy: { select: { id: true, username: true, avatarUrl: true } } };
type Template = Prisma.OrbatTemplateGetPayload<{ include: typeof include }>;
type Slot = { name: string; squadRoleId: number | null; orderIndex: number; maxSignups: number };
type Squad = { name: string; orderIndex: number; slots: Slot[] };
const templateSlots = (value: unknown) => normalizeTemplateSlots(value) as Squad[];
type Input = Partial<Record<typeof texts[number], string | null>> & { name?: string; slotsJson?: Squad[]; frequencyIds?: number[]; tempFrequencies?: NonNullable<ReturnType<typeof parseOrbatCreate>['data']>['tempFrequencies']; isSideOp?: boolean; isActive?: boolean };
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
export function parseOrbatTemplate(body: unknown, creating: boolean): { data: Input; error?: never } | { error: Response; data?: never } {
  const invalid = () => ({ error: apiError(422, 'validation_failed', 'Invalid template payload. Use canonical fields, numeric references, unique positions and HH:MM time defaults.') });
  if (!object(body) || !Object.keys(body).length || Object.keys(body).some(key => !['name', 'slotsJson', 'frequencyIds', 'tempFrequencies', 'isSideOp', ...(!creating ? ['isActive'] : []), ...texts].includes(key))) return invalid();
  const data: Input = {};
  if (creating || 'name' in body) { if (typeof body.name !== 'string' || !body.name.trim()) return invalid(); data.name = body.name.trim(); }
  for (const key of texts) if (key in body) {
    if (body[key] !== null && typeof body[key] !== 'string') return invalid();
    const value = typeof body[key] === 'string' ? body[key].trim() || null : null;
    if ((key === 'startTime' || key === 'endTime') && value !== null && !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return invalid();
    data[key] = value;
  }
  for (const key of ['isSideOp', 'isActive'] as const) if (key in body) { if (typeof body[key] !== 'boolean') return invalid(); data[key] = body[key]; }
  let squads: unknown = [{ name: 'Validation', orderIndex: 0, slots: [{ orderIndex: 0, maxSignups: 1 }] }];
  if (creating || 'slotsJson' in body) {
    if (!Array.isArray(body.slotsJson)) return invalid();
    const converted = [];
    for (const squad of body.slotsJson) {
      if (!object(squad) || Object.keys(squad).some(key => !['name', 'orderIndex', 'slots'].includes(key)) || !Array.isArray(squad.slots)) return invalid();
      const slots = [];
      for (const slot of squad.slots) {
        if (!object(slot) || Object.keys(slot).some(key => !['name', 'squadRoleId', 'orderIndex', 'maxSignups'].includes(key)) || typeof slot.name !== 'string' || !slot.name.trim()) return invalid();
        const { name: _name, ...fields } = slot; slots.push(fields);
      }
      converted.push({ ...squad, slots });
    }
    squads = converted;
  }
  const parsed = parseOrbatCreate({ name: 'Validation', squads, ...(body.frequencyIds !== undefined ? { frequencyIds: body.frequencyIds } : {}), ...(body.tempFrequencies !== undefined ? { tempFrequencies: body.tempFrequencies } : {}) });
  if (parsed.error) return invalid();
  if (creating || 'slotsJson' in body) data.slotsJson = parsed.data!.squads.map((squad, index) => ({ ...squad, slots: squad.slots.map((slot, slotIndex) => ({ ...slot, name: (body.slotsJson as { slots: { name: string }[] }[])[index].slots[slotIndex].name.trim() })) }));
  if (creating || 'frequencyIds' in body) data.frequencyIds = parsed.data!.frequencyIds;
  if (creating || 'tempFrequencies' in body) data.tempFrequencies = parsed.data!.tempFrequencies;
  return { data };
}
async function serialize(db: Pick<Prisma.TransactionClient, 'squadRole'>, rows: Template[]) {
  const normalized = rows.map(row => normalizeTemplateForRead({ ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() }));
  const ids = [...new Set(normalized.flatMap(row => templateSlots(row.slotsJson).flatMap(squad => squad.slots).flatMap(slot => slot.squadRoleId ? [slot.squadRoleId] : [])))];
  const roles = ids.length ? await db.squadRole.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, requiredTrainingIds: true, requiredRankIds: true } }) : [];
  return normalized.map(row => ({ ...row,
    tempFrequencies: (row.tempFrequencies as Record<string, unknown>[]).filter(object).map(item => ({ frequency: typeof item.frequency === 'string' ? item.frequency : '', type: item.type === 'LR' ? 'LR' : 'SR', isAdditional: item.isAdditional === true, channel: typeof item.channel === 'string' ? item.channel : '', callsign: typeof item.callsign === 'string' ? item.callsign : '' })),
    slotsJson: templateSlots(row.slotsJson).map(squad => ({ name: squad.name, orderIndex: squad.orderIndex, slots: squad.slots.map(slot => {
      const role = roles.find(item => item.id === slot.squadRoleId);
      return { name: role?.name ?? slot.name, orderIndex: slot.orderIndex, maxSignups: slot.maxSignups, squadRoleId: slot.squadRoleId ?? null, requiredTrainingIds: role?.requiredTrainingIds ?? [], requiredRankIds: role?.requiredRankIds ?? [] };
    }) })) }));
}
const snapshot = (row: Template) => ({ id: row.id, isActive: row.isActive, isSideOp: row.isSideOp, frequencyIds: row.frequencyIds, roleIds: [...new Set(templateSlots(row.slotsJson).flatMap(squad => squad.slots).flatMap(slot => slot.squadRoleId ? [slot.squadRoleId] : []))], squadCount: templateSlots(row.slotsJson).length });
export function orbatTemplateError(error: unknown): Response {
  const code = (error as { code?: string })?.code;
  if (code === 'P2025') return apiError(404, 'not_found', 'Template not found.');
  if (['P2002', 'P2003', 'P2034'].includes(code ?? '')) return apiError(409, 'conflict', 'Template name already exists or references changed concurrently. Reload and retry.');
  throw error;
}
export function orbatTemplateRequest(request: Request, operation: 'list' | 'read' | 'access' | 'create' | 'update' | 'delete', rawId?: string) {
  const permission = operation === 'create' ? 'template:create' : operation === 'update' ? 'template:edit' : operation === 'delete' ? 'template:delete' : undefined;
  return handleApiRequest(request, permission, async (principal, audit) => {
    const canRead = readPermissions.some(key => hasApiPermission(principal.permissions, key));
    if ((operation === 'list' || operation === 'read') && !canRead) return apiError(403, 'forbidden', 'Template or ORBAT management permission required.');
    const query = new URL(request.url).searchParams;
    if ([...query.keys()].some(key => operation !== 'list' || !['limit', 'cursor'].includes(key) || query.getAll(key).length !== 1)) return apiError(400, 'invalid_request', 'Unexpected or repeated query parameter.');
    if (operation === 'access') return apiSuccess({ canRead, canCreate: hasApiPermission(principal.permissions, 'template:create'), canEdit: hasApiPermission(principal.permissions, 'template:edit'), canDelete: hasApiPermission(principal.permissions, 'template:delete') });
    const id = rawId === undefined ? null : parsePositiveId(rawId);
    if (['read', 'update', 'delete'].includes(operation) && (id === null || id > 2147483647)) return apiError(400, 'invalid_request', 'Invalid template ID.');
    if (operation === 'list' || operation === 'read') {
      const paging = parseCursorPagination(query, { defaultLimit: 50, maxLimit: 100 });
      if (paging.error) return apiError(400, 'invalid_request', paging.error);
      const { limit, cursor } = paging.data!;
      const rows = operation === 'list' ? await prisma.orbatTemplate.findMany({ where: { isActive: true, ...(cursor ? { id: { gt: cursor } } : {}) }, orderBy: { id: 'asc' }, take: limit + 1, include }) : [await prisma.orbatTemplate.findUnique({ where: { id: id! }, include })].filter((row): row is Template => row !== null);
      if (operation === 'read' && !rows.length) return apiError(404, 'not_found', 'Template not found.');
      const page = rows.slice(0, limit);
      const targets = page.flatMap(row => row.createdBy && (principal.kind === 'bot' || row.createdBy.id !== principal.userId) ? [row.createdBy.id] : []);
      if (targets.length) await writeApiAudit(prisma, audit, { action: 'user_data.read', resource: 'orbat_template', ...(id ? { resourceId: String(id) } : {}), outcome: 'success', targetUserIds: targets });
      const result = await serialize(prisma, page);
      return operation === 'read' ? apiSuccess(result[0]) : apiSuccess(result, { meta: { limit, nextCursor: rows.length > limit ? String(page[limit - 1].id) : null } });
    }
    const parsed = operation === 'delete' ? { data: {} as Input } : parseOrbatTemplate(await readJsonBody(request), operation === 'create');
    if (parsed.error) return parsed.error;
    try {
      const result = await prisma.$transaction(async tx => {
        const before = id === null ? null : await tx.orbatTemplate.findUnique({ where: { id }, include });
        if (id !== null && !before) return { error: apiError(404, 'not_found', 'Template not found.') };
        const input = parsed.data!;
        if (input.slotsJson) {
          const ids = [...new Set(input.slotsJson.flatMap(squad => squad.slots).flatMap(slot => slot.squadRoleId ? [slot.squadRoleId] : []))];
          const roles = ids.length ? await tx.squadRole.findMany({ where: { id: { in: ids } }, select: { id: true, isRetired: true } }) : [];
          if (roles.length !== ids.length) return { error: apiError(404, 'not_found', 'One or more role definitions do not exist.') };
          if (roles.some(role => role.isRetired)) return { error: apiError(409, 'conflict', 'Retired roles cannot be saved in a template.') };
        }
        if (input.frequencyIds?.length && await tx.radioFrequency.count({ where: { id: { in: input.frequencyIds } } }) !== input.frequencyIds.length) return { error: apiError(404, 'not_found', 'One or more radio frequencies do not exist.') };
        const row = operation === 'create' ? await tx.orbatTemplate.create({ data: { ...input, name: input.name!, slotsJson: input.slotsJson!, frequencyIds: input.frequencyIds!, createdById: principal.kind === 'user' ? principal.userId : null }, include }) : await tx.orbatTemplate.update({ where: { id: id! }, data: operation === 'delete' ? { isActive: false } : input, include });
        await writeApiAudit(tx, audit, { action: `orbat_template.${operation === 'create' ? 'created' : operation === 'delete' ? 'deleted' : 'updated'}`, resource: 'orbat_template', resourceId: String(row.id), outcome: 'success', ...(before ? { before: snapshot(before) } : {}), after: snapshot(row) });
        return { row, data: operation === 'delete' ? null : (await serialize(tx, [row]))[0] };
      }, { isolationLevel: 'Serializable' });
      if (result.error) return result.error;
      try { publishAdminCatalogEvent({ type: 'template.changed', actorUserId: principal.kind === 'user' ? principal.userId : null, payload: { action: operation === 'create' ? 'created' : operation === 'delete' ? 'deleted' : 'updated', templateId: result.row!.id } }); } catch { console.error('Template notification failed', { correlationId: audit.correlationId }); }
      return apiSuccess(result.data, { status: operation === 'create' ? 201 : 200 });
    } catch (error) { return orbatTemplateError(error); }
  });
}
