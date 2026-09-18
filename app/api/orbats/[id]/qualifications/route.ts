import { prisma } from '@/lib/prisma';
import { credentialRoute, credentialId } from '@/lib/api/user-trainings';
import { isRequestStaff, requestUserSelect as userSelect } from '@/lib/api/training-requests';
import { apiError, apiSuccess } from '@/lib/api/response';
import { writeApiAudit } from '@/lib/api/audit';
async function getRelevantTrainingIds(orbatId: number) {
  const slots = await prisma.slot.findMany({ where: { orbatId }, select: { squadRole: { select: { requiredTrainingIds: true } } } });
  return [...new Set(slots.flatMap(slot => slot.squadRole?.requiredTrainingIds ?? []))];
}
export function GET(request: Request, context: { params: Promise<{ id: string }> }) {
 return credentialRoute(request, async (principal, audit) => {
  if (!isRequestStaff(principal)) return apiError(403, 'forbidden', 'Training staff rights required.');
  const orbatId = credentialId((await context.params).id);
  const query = new URL(request.url).searchParams;
  for (const key of query.keys()) if (!['limit','cursor'].includes(key) || query.getAll(key).length !== 1) return apiError(400, 'invalid_request', 'Invalid query.');
  const limit = query.has('limit') ? credentialId(query.get('limit')!) : 50;
  const cursor = query.has('cursor') ? credentialId(query.get('cursor')!) : undefined;
  if (limit > 100) return apiError(400, 'invalid_request', 'limit cannot exceed 100.');
  const orbat = await prisma.orbat.findUnique({ where: { id: orbatId }, select: { isSideOp: true } });
  if (!orbat) return apiError(404, 'not_found', 'Operation not found.');
  if (orbat.isSideOp) return apiError(409, 'conflict', 'Side operations do not evaluate qualifications.');
  const access = { orbatId };
  const trainingIds = await getRelevantTrainingIds(access.orbatId);
  if (trainingIds.length === 0) {
    return apiSuccess({ groups: [], total: 0, orbatId }, { meta: { limit, nextCursor: null } });
  }

  const [credentials, signups, slots] = await Promise.all([
    prisma.userTraining.findMany({
      where: { trainingId: { in: trainingIds }, status: 'needs_qualify', ...(cursor ? { id: { lt: cursor } } : {}) },
      include: {
        training: true,
        user: { select: userSelect },
      },
      orderBy: { id: 'desc' }, take: limit + 1,
    }),
    prisma.signup.findMany({
      where: { slot: { orbatId: access.orbatId } },
      include: {
        slot: {
          include: {
            squad: { select: { id: true, name: true } },
            squadRole: { select: { name: true, requiredTrainingIds: true } },
          },
        },
      },
    }),
    prisma.slot.findMany({
      where: { orbatId: access.orbatId },
      select: {
        id: true,
        maxSignups: true,
        squad: { select: { name: true } },
        squadRole: { select: { name: true, requiredTrainingIds: true } },
        _count: { select: { signups: true } },
      },
      orderBy: [{ squad: { orderIndex: 'asc' } }, { orderIndex: 'asc' }],
    }),
  ]);

  const hasMore = credentials.length > limit;
  const visible = credentials.slice(0, limit);
  const targets = [...new Set(visible.map(row => row.userId))].filter(id => principal.kind === 'bot' || principal.userId !== id);
  if (targets.length) await writeApiAudit(prisma, audit, { action: 'user_data.read', resource: 'orbat_qualification', resourceId: String(orbatId), targetUserIds: targets, outcome: 'success' });
  const signupByUserId = new Map(signups.map((signup) => [signup.userId, signup]));
  const groups = trainingIds.map((trainingId) => {
    const rows = visible.filter((credential) => credential.trainingId === trainingId);
    const training = rows[0]?.training;
    return {
      training: training ? {
        id: training.id,
        name: training.name,
        qualificationNotes: training.orbatQualificationNotes,
      } : { id: trainingId, name: `Training #${trainingId}`, qualificationNotes: null },
      availableSlots: slots
        .filter((slot) =>
          slot.squadRole?.requiredTrainingIds.includes(trainingId)
          && (slot.maxSignups === null || slot._count.signups < slot.maxSignups),
        )
        .map((slot) => ({
          id: slot.id,
          label: `${slot.squad.name} — ${slot.squadRole?.name ?? 'Unassigned Role'}`,
          remainingCapacity: slot.maxSignups === null
            ? null
            : Math.max(0, slot.maxSignups - slot._count.signups),
        })),
      users: rows.map((credential) => {
        const signup = signupByUserId.get(credential.userId);
        const slotRelevant = signup?.slot.squadRole?.requiredTrainingIds.includes(trainingId) ?? false;
        return {
          userTrainingId: credential.id,
          existingSignupId: signup?.id ?? null,
          user: credential.user,
          status: credential.status,
          notes: credential.notes,
          assignedSlot: signup && slotRelevant
            ? {
                signupId: signup.id,
                slotId: signup.slotId,
                slotName: signup.slot.squadRole?.name ?? 'Unassigned Role',
                squadName: signup.slot.squad.name,
              }
            : null,
        };
      }),
    };
  }).filter((group) => group.users.length > 0);

  return apiSuccess({
    groups,
    total: visible.length,
    orbatId: access.orbatId,
  }, { meta: { limit, nextCursor: hasMore ? String(visible.at(-1)!.id) : null } });
 });
}
