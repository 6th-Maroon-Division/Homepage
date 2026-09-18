import type { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import { parseOrbatCreate } from './orbat-create';
import { apiError } from './response';
import { writeApiAudit, type ApiAuditContext } from './audit';
import type { ApiPrincipal } from './principal';
import { appendBotEvent } from '@/lib/bot-events';
import { publishOrbatEvent } from '@/lib/realtime/orbat-events';
import { publishAdminCatalogEvent } from '@/lib/realtime/admin-catalog-events';

type Input = NonNullable<ReturnType<typeof parseOrbatCreate>['data']>;
type Squad = Omit<Input['squads'][number], 'slots'> & { id?: number; slots: (Input['squads'][number]['slots'][number] & { id?: number })[] };
type Patch = Omit<Partial<Input>, 'squads'> & { squads?: Squad[] };
const idValid = (id: unknown): id is number => typeof id === 'number' && Number.isInteger(id) && id > 0 && id <= 2147483647;
export function parseOrbatPatch(value: unknown): { data: Patch; error?: never } | { error: Response; data?: never } {
  const invalid = () => ({ error: apiError(422, 'validation_failed', 'Provide canonical operation fields and unique owned squad and slot IDs.') });
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Object.keys(value).length) return invalid();
  const input = value as Record<string, unknown>;
  let stripped: unknown = input.squads;
  const squadIds = new Set<number>(); const slotIds = new Set<number>();
  if (Array.isArray(input.squads)) {
    stripped = input.squads.map(squad => {
      if (!squad || typeof squad !== 'object' || Array.isArray(squad)) return squad;
      const { id, slots, ...rest } = squad;
      if ('id' in squad) { if (!idValid(id) || squadIds.has(id)) return null; squadIds.add(id); }
      return { ...rest, slots: Array.isArray(slots) ? slots.map(slot => {
        if (!slot || typeof slot !== 'object' || Array.isArray(slot)) return slot;
        const { id: slotId, ...fields } = slot;
        if ('id' in slot) { if (!idValid(slotId) || slotIds.has(slotId)) return null; slotIds.add(slotId); }
        return fields;
      }) : slots };
    });
  }
  const parsed = parseOrbatCreate({ name: 'Validation default', squads: [{ name: 'Validation default', orderIndex: 0, slots: [{ orderIndex: 0, maxSignups: 1 }] }], ...input, ...(input.squads !== undefined ? { squads: stripped } : {}) }, { allowPast: true, allowIncompleteTiming: true });
  if (parsed.error) return parsed;
  const data = Object.fromEntries(Object.keys(input).map(key => [key, parsed.data[key as keyof Input]])) as Patch;
  if (data.squads) data.squads = data.squads.map((squad, index) => ({ ...squad, ...((input.squads as Squad[])[index].id !== undefined ? { id: (input.squads as Squad[])[index].id } : {}), slots: squad.slots.map((slot, slotIndex) => ({ ...slot, ...((input.squads as Squad[])[index].slots[slotIndex].id !== undefined ? { id: (input.squads as Squad[])[index].slots[slotIndex].id } : {}) })) }));
  return { data };
}
const editorInclude = { squads: { orderBy: { orderIndex: 'asc' }, include: { slots: { orderBy: { orderIndex: 'asc' }, include: { squadRole: { select: { id: true, name: true, requiredTrainingIds: true, requiredRankIds: true, isRetired: true } } } } } }, frequencies: { orderBy: { id: 'asc' }, select: { radioFrequencyId: true } } } as const;
export async function getOrbatEditor(id: number) {
  const row = await prisma.orbat.findUnique({ where: { id }, include: editorInclude });
  if (!row) return null;
  const { createdById: _creator, createdAt: _created, frequencies, ...data } = row;
  return { ...data, eventDate: row.eventDate?.toISOString() ?? null, startsAtUtc: row.startsAtUtc?.toISOString() ?? null, endsAtUtc: row.endsAtUtc?.toISOString() ?? null, frequencyIds: frequencies.map(item => item.radioFrequencyId) };
}
const dependencies = {
  squads: { select: { id: true, orderIndex: true, slots: { select: { id: true, squadRoleId: true, maxSignups: true, orderIndex: true, signups: { select: { id: true, userId: true } } } } } },
  attendances: { select: { id: true, userId: true, signupId: true, sessions: { select: { id: true } }, logs: { select: { id: true } } } },
  attendanceNotes: { select: { id: true, userId: true } },
  trainingStatusChanges: { select: { id: true, userTraining: { select: { userId: true } } } },
  frequencies: { select: { id: true, radioFrequencyId: true } },
} as const;
type Existing = Prisma.OrbatGetPayload<{ include: typeof dependencies }>;
function snapshot(row: Existing) {
  return { id: row.id, name: '[REDACTED]', description: row.description === null ? null : '[REDACTED]', timezone: row.timezone, temporaryFrequencyCount: Array.isArray(row.tempFrequencies) ? row.tempFrequencies.length : 0, startsAtUtc: row.startsAtUtc?.toISOString() ?? null, endsAtUtc: row.endsAtUtc?.toISOString() ?? null, eventDate: row.eventDate?.toISOString() ?? null, isSideOp: row.isSideOp, squads: row.squads.map(squad => ({ id: squad.id, orderIndex: squad.orderIndex, slots: squad.slots.map(slot => ({ id: slot.id, orderIndex: slot.orderIndex, squadRoleId: slot.squadRoleId, maxSignups: slot.maxSignups, signupIds: slot.signups.map(signup => signup.id) })) })), attendanceIds: row.attendances.map(item => item.id), attendanceSessionIds: row.attendances.flatMap(item => item.sessions.map(session => session.id)), attendanceLogIds: row.attendances.flatMap(item => item.logs.map(log => log.id)), attendanceNoteIds: row.attendanceNotes.map(item => item.id), trainingStatusChangeIds: row.trainingStatusChanges.map(item => item.id), frequencyIds: row.frequencies.map(item => item.radioFrequencyId) };
}
function publish(principal: ApiPrincipal, context: ApiAuditContext, id: number, action: 'updated' | 'deleted') {
  const actorUserId = principal.kind === 'user' ? principal.userId : null;
  for (const notify of [() => publishOrbatEvent({ type: `orbat.${action}`, orbatId: id, actorUserId }), () => publishAdminCatalogEvent({ type: 'orbat.changed', actorUserId, payload: { action, orbatId: id } })]) {
    try { notify(); } catch { console.error('Operation notification failed', { correlationId: context.correlationId, timestamp: new Date().toISOString() }); }
  }
}
export async function mutateOrbat(principal: ApiPrincipal, context: ApiAuditContext, id: number, patch: Patch | null) {
  try {
    const result = await prisma.$transaction(async tx => {
      const existing = await tx.orbat.findUnique({ where: { id }, include: dependencies });
      if (!existing) return { error: apiError(404, 'not_found', 'Operation not found.') };
      const allSlots = existing.squads.flatMap(squad => squad.slots);
      const targets = new Set<number>();
      if (patch === null) {
        allSlots.flatMap(slot => slot.signups).forEach(signup => targets.add(signup.userId));
        existing.attendances.forEach(row => targets.add(row.userId));
        existing.attendanceNotes.forEach(row => targets.add(row.userId));
        existing.trainingStatusChanges.forEach(row => targets.add(row.userTraining.userId));
        await tx.orbat.delete({ where: { id } });
      } else {
        const start = patch.startsAtUtc === undefined ? existing.startsAtUtc : patch.startsAtUtc;
        const end = patch.endsAtUtc === undefined ? existing.endsAtUtc : patch.endsAtUtc;
        if (end && (!start || end <= start)) return { error: apiError(422, 'validation_failed', 'End datetime must follow the start datetime.') };
        if (patch.squads) {
          const ownedSquads = new Set(existing.squads.map(squad => squad.id)); const ownedSlots = new Set(allSlots.map(slot => slot.id));
          if (patch.squads.some(squad => squad.id !== undefined && !ownedSquads.has(squad.id) || squad.slots.some(slot => slot.id !== undefined && !ownedSlots.has(slot.id)))) return { error: apiError(404, 'not_found', 'Squad or slot does not belong to this operation.') };
          const roles = [...new Set(patch.squads.flatMap(squad => squad.slots).flatMap(slot => slot.squadRoleId === null ? [] : [slot.squadRoleId]))];
          const found = roles.length ? await tx.squadRole.findMany({ where: { id: { in: roles } }, select: { id: true, isRetired: true } }) : [];
          if (found.length !== roles.length) return { error: apiError(404, 'not_found', 'Role definition not found.') };
          if (found.some(role => role.isRetired)) return { error: apiError(409, 'conflict', 'Retired roles cannot be used.') };
        }
        if (patch.frequencyIds?.length && await tx.radioFrequency.count({ where: { id: { in: patch.frequencyIds } } }) !== patch.frequencyIds.length) return { error: apiError(404, 'not_found', 'Radio frequency not found.') };
        const { squads, frequencyIds, eventDateUtc, ...fields } = patch;
        await tx.orbat.update({ where: { id }, data: { ...fields, ...(patch.startsAtUtc !== undefined || patch.eventDateUtc !== undefined ? { eventDate: start ?? (eventDateUtc === undefined ? existing.eventDate : eventDateUtc) } : {}), ...(patch.startsAtUtc !== undefined ? { startTime: start?.toISOString().slice(11, 16) ?? null } : {}), ...(patch.endsAtUtc !== undefined ? { endTime: end?.toISOString().slice(11, 16) ?? null } : {}) } });
        if (squads) {
          const retained = new Set(squads.flatMap(squad => squad.slots).flatMap(slot => slot.id === undefined ? [] : [slot.id]));
          const removed = allSlots.filter(slot => !retained.has(slot.id));
          removed.flatMap(slot => slot.signups).forEach(signup => targets.add(signup.userId));
          await tx.slot.deleteMany({ where: { id: { in: removed.map(slot => slot.id) } } });
          // Unique negative staging positions avoid collisions and overflow at arbitrary positive indices.
          let staging = -1;
          const occupied = new Set(allSlots.map(slot => slot.orderIndex));
          for (const slot of allSlots.filter(slot => retained.has(slot.id))) {
            while (occupied.has(staging)) staging--;
            await tx.slot.update({ where: { id: slot.id }, data: { orderIndex: staging } });
            occupied.add(staging--);
          }
          const retainedSquads: number[] = [];
          for (const squad of squads) {
            const saved = squad.id === undefined ? await tx.squad.create({ data: { orbatId: id, name: squad.name, orderIndex: squad.orderIndex } }) : await tx.squad.update({ where: { id: squad.id }, data: { name: squad.name, orderIndex: squad.orderIndex } });
            retainedSquads.push(saved.id);
            for (const { id: slotId, ...slot } of squad.slots) {
              if (slotId === undefined) await tx.slot.create({ data: { ...slot, orbatId: id, squadId: saved.id } });
              else await tx.slot.update({ where: { id: slotId }, data: { ...slot, squadId: saved.id } });
            }
          }
          await tx.squad.deleteMany({ where: { orbatId: id, id: { notIn: retainedSquads } } });
        }
        if (frequencyIds !== undefined) {
          await tx.orbatRadioFrequency.deleteMany({ where: { orbatId: id } });
          if (frequencyIds.length) await tx.orbatRadioFrequency.createMany({ data: frequencyIds.map(radioFrequencyId => ({ orbatId: id, radioFrequencyId })) });
        }
      }
      await appendBotEvent({ type: patch === null ? 'orbat.deleted' : 'orbat.updated', aggregate: 'orbat', aggregateId: id, payload: { orbatId: id, version: new Date().toISOString() } }, tx);
      const after = patch === null ? null : await tx.orbat.findUniqueOrThrow({ where: { id }, include: dependencies });
      await writeApiAudit(tx, context, { action: patch === null ? 'orbat.deleted' : 'orbat.updated', resource: 'orbat', resourceId: String(id), targetUserIds: [...targets], outcome: 'success', before: snapshot(existing), after: after ? snapshot(after) : { deleted: true } });
      return { data: patch === null ? null : { id } };
    }, { isolationLevel: 'Serializable' });
    if (!result.error) publish(principal, context, id, patch === null ? 'deleted' : 'updated');
    return result;
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error) {
      if (error.code === 'P2025') return { error: apiError(404, 'not_found', 'Operation not found.') };
      if (['P2002', 'P2003', 'P2034'].includes(String(error.code))) return { error: apiError(409, 'conflict', 'Operation changed concurrently. Reload and retry.') };
    }
    throw error;
  }
}
