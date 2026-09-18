import { prisma } from '@/lib/prisma';
import { appendBotEvent } from '@/lib/bot-events';
import { publishOrbatEvent } from '@/lib/realtime/orbat-events';
import { publishAdminCatalogEvent } from '@/lib/realtime/admin-catalog-events';
import { writeApiAudit, type ApiAuditContext } from './audit';
import type { ApiPrincipal } from './principal';
import { apiError } from './response';
import { parseUtcTimestamp } from './utc';

const textFields = ['description', 'timezone', 'bluforCountry', 'bluforRelationship', 'opforCountry', 'opforRelationship', 'indepCountry', 'indepRelationship', 'iedThreat', 'civilianRelationship', 'rulesOfEngagement', 'airspace', 'inGameTimezone', 'operationDay'] as const;
type TextField = typeof textFields[number];
type SlotInput = { squadRoleId: number | null; orderIndex: number; maxSignups: number };
type SquadInput = { name: string; orderIndex: number; slots: SlotInput[] };
type TemporaryFrequency = { frequency: string; type: 'SR' | 'LR'; isAdditional: boolean; channel: string; callsign: string };
type CreateInput = Record<TextField, string | null> & { name: string; squads: SquadInput[]; frequencyIds: number[]; tempFrequencies: TemporaryFrequency[]; startsAtUtc: Date | null; endsAtUtc: Date | null; eventDateUtc: Date | null; isSideOp: boolean };
type Parsed<T> = { data: T; error?: never } | { error: Response; data?: never };
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const int = (value: unknown, minimum = 1): value is number => typeof value === 'number' && Number.isInteger(value) && value >= minimum && value <= 2147483647;
const exact = (value: Record<string, unknown>, fields: readonly string[]) => Object.keys(value).every(key => fields.includes(key));
const nonempty = (value: unknown): value is string => typeof value === 'string' && !!value.trim();
export function parseOrbatCreate(body: unknown, options: { allowPast?: boolean; allowIncompleteTiming?: boolean } = {}): Parsed<CreateInput> {
  const invalid = () => ({ error: apiError(422, 'validation_failed', 'Invalid operation creation payload. Use canonical fields, valid UTC timestamps and unique numeric references and positions.') });
  if (!record(body) || !exact(body, ['name', 'squads', 'frequencyIds', 'tempFrequencies', 'startsAtUtc', 'endsAtUtc', 'eventDateUtc', 'isSideOp', ...textFields]) || !nonempty(body.name)) return invalid();
  const text = {} as Record<TextField, string | null>;
  for (const key of textFields) {
    if (body[key] !== undefined && body[key] !== null && typeof body[key] !== 'string') return invalid();
    text[key] = typeof body[key] === 'string' ? body[key].trim() || null : null;
  }
  const dates = {} as Pick<CreateInput, 'startsAtUtc' | 'endsAtUtc' | 'eventDateUtc'>;
  for (const key of ['startsAtUtc', 'endsAtUtc', 'eventDateUtc'] as const) {
    dates[key] = body[key] === undefined || body[key] === null ? null : parseUtcTimestamp(body[key]);
    if (body[key] !== undefined && body[key] !== null && !dates[key]) return invalid();
  }
  const now = new Date();
  if (!options.allowIncompleteTiming && dates.endsAtUtc && (!dates.startsAtUtc || dates.endsAtUtc <= dates.startsAtUtc)) return invalid();
  if (!options.allowPast && dates.startsAtUtc && dates.startsAtUtc < now) return invalid();
  if (!options.allowPast && !dates.startsAtUtc && dates.eventDateUtc && dates.eventDateUtc < new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))) return invalid();
  if (body.isSideOp !== undefined && typeof body.isSideOp !== 'boolean') return invalid();
  if (!Array.isArray(body.squads) || !body.squads.length) return invalid();
  const squads: SquadInput[] = [];
  const squadPositions = new Set<number>();
  for (const squad of body.squads) {
    if (!record(squad) || !exact(squad, ['name', 'orderIndex', 'slots']) || !nonempty(squad.name) || !int(squad.orderIndex, 0) || squadPositions.has(squad.orderIndex) || !Array.isArray(squad.slots) || !squad.slots.length) return invalid();
    squadPositions.add(squad.orderIndex);
    const slots: SlotInput[] = [];
    const positions = new Set<number>();
    for (const slot of squad.slots) {
      if (!record(slot) || !exact(slot, ['squadRoleId', 'orderIndex', 'maxSignups']) || !int(slot.orderIndex, 0) || positions.has(slot.orderIndex) || !int(slot.maxSignups) || (slot.squadRoleId !== undefined && slot.squadRoleId !== null && !int(slot.squadRoleId))) return invalid();
      positions.add(slot.orderIndex);
      slots.push({ squadRoleId: slot.squadRoleId as number | null | undefined ?? null, orderIndex: slot.orderIndex, maxSignups: slot.maxSignups });
    }
    squads.push({ name: squad.name.trim(), orderIndex: squad.orderIndex, slots });
  }
  const frequencyIds = body.frequencyIds ?? [];
  if (!Array.isArray(frequencyIds) || !frequencyIds.every(id => int(id)) || new Set(frequencyIds).size !== frequencyIds.length || body.frequencyIds === null) return invalid();
  const frequencies = body.tempFrequencies ?? [];
  if (!Array.isArray(frequencies) || body.tempFrequencies === null) return invalid();
  const tempFrequencies: TemporaryFrequency[] = [];
  for (const frequency of frequencies) {
    if (!record(frequency) || !exact(frequency, ['frequency', 'type', 'isAdditional', 'channel', 'callsign']) || !nonempty(frequency.frequency) || !['SR', 'LR'].includes(frequency.type as string) || typeof frequency.isAdditional !== 'boolean' || typeof frequency.channel !== 'string' || typeof frequency.callsign !== 'string') return invalid();
    tempFrequencies.push({ frequency: frequency.frequency.trim(), type: frequency.type as 'SR' | 'LR', isAdditional: frequency.isAdditional, channel: frequency.channel.trim(), callsign: frequency.callsign.trim() });
  }
  return { data: { ...text, ...dates, name: body.name.trim(), squads, frequencyIds, tempFrequencies, isSideOp: body.isSideOp === true } };
}

export async function createOrbat(principal: ApiPrincipal, context: ApiAuditContext, input: CreateInput): Promise<Parsed<{ id: number }>> {
  try {
    const result = await prisma.$transaction(async tx => {
      const roleIds = [...new Set(input.squads.flatMap(squad => squad.slots).flatMap(slot => slot.squadRoleId === null ? [] : [slot.squadRoleId]))];
      const roles = roleIds.length ? await tx.squadRole.findMany({ where: { id: { in: roleIds } }, select: { id: true, isRetired: true } }) : [];
      if (roles.length !== roleIds.length) return { error: apiError(404, 'not_found', 'One or more role definitions do not exist.') };
      if (roles.some(role => role.isRetired)) return { error: apiError(409, 'conflict', 'Retired role definitions cannot be used.') };
      const frequencies = input.frequencyIds.length ? await tx.radioFrequency.findMany({ where: { id: { in: input.frequencyIds } }, select: { id: true } }) : [];
      if (frequencies.length !== input.frequencyIds.length) return { error: apiError(404, 'not_found', 'One or more radio frequencies do not exist.') };
      const { squads, frequencyIds, eventDateUtc, ...fields } = input;
      const orbat = await tx.orbat.create({ data: { ...fields, eventDate: input.startsAtUtc ?? eventDateUtc, startTime: input.startsAtUtc?.toISOString().slice(11, 16) ?? null, endTime: input.endsAtUtc?.toISOString().slice(11, 16) ?? null, createdById: principal.kind === 'user' ? principal.userId : null } });
      const createdSquads: { id: number; slotIds: number[] }[] = [];
      for (const squadInput of squads) {
        const squad = await tx.squad.create({ data: { orbatId: orbat.id, name: squadInput.name, orderIndex: squadInput.orderIndex } });
        const slotIds: number[] = [];
        for (const slot of squadInput.slots) {
          const created = await tx.slot.create({ data: { ...slot, orbatId: orbat.id, squadId: squad.id } });
          slotIds.push(created.id);
        }
        createdSquads.push({ id: squad.id, slotIds });
      }
      if (frequencyIds.length) await tx.orbatRadioFrequency.createMany({ data: frequencyIds.map(radioFrequencyId => ({ orbatId: orbat.id, radioFrequencyId })) });
      await appendBotEvent({ type: 'orbat.created', aggregate: 'orbat', aggregateId: orbat.id, payload: { orbatId: orbat.id, version: orbat.createdAt.toISOString(), name: orbat.name } }, tx);
      await writeApiAudit(tx, context, { action: 'orbat.created', resource: 'orbat', resourceId: String(orbat.id), outcome: 'success', after: { id: orbat.id, createdById: orbat.createdById, startsAtUtc: input.startsAtUtc?.toISOString() ?? null, endsAtUtc: input.endsAtUtc?.toISOString() ?? null, eventDate: orbat.eventDate?.toISOString() ?? null, isSideOp: input.isSideOp, squads: createdSquads, roleIds, frequencyIds } });
      return { data: orbat };
    }, { isolationLevel: 'Serializable' });
    if (result.error) return { error: result.error };
    const orbat = result.data!;
    const actorUserId = principal.kind === 'user' ? principal.userId : null;
    try { publishOrbatEvent({ type: 'orbat.created', orbatId: orbat.id, actorUserId, payload: { id: orbat.id, name: orbat.name, description: orbat.description, startsAtUtc: orbat.startsAtUtc?.toISOString() ?? null, eventDate: (orbat.startsAtUtc ?? orbat.eventDate ?? orbat.createdAt).toISOString(), isSideOp: orbat.isSideOp } }); }
    catch { console.error('Operation notification failed', { correlationId: context.correlationId, timestamp: new Date().toISOString() }); }
    try { publishAdminCatalogEvent({ type: 'orbat.changed', actorUserId, payload: { action: 'created', orbatId: orbat.id } }); }
    catch { console.error('Operation catalog notification failed', { correlationId: context.correlationId, timestamp: new Date().toISOString() }); }
    return { data: { id: orbat.id } };
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error) {
      if (error.code === 'P2025') return { error: apiError(404, 'not_found', 'An operation reference no longer exists.') };
      if (['P2002', 'P2003', 'P2034'].includes(String(error.code))) return { error: apiError(409, 'conflict', 'Operation references changed concurrently. Reload and retry.') };
    }
    throw error;
  }
}
