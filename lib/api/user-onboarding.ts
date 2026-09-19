import type { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import { getCurrentAttendance } from '@/lib/rank-eligibility';
import { handleApiRequest } from './handler';
import { writeApiAudit } from './audit';
import { apiError, apiSuccess } from './response';
import { parseCursorPagination } from './validation';
import { userVisibility } from './user-directory';
export async function getUserOnboarding(request: Request) {
  return handleApiRequest(request, 'user:manage', async (principal, context) => {
    const params = new URL(request.url).searchParams;
    const booleans = ['interviewDone', 'retired', 'requiredTrainingsCompleted'] as const;
    if ([...params.keys()].some(key => !['limit', 'cursor', ...booleans].includes(key) || params.getAll(key).length !== 1) || booleans.some(key => params.has(key) && !['true', 'false'].includes(params.get(key)!))) return apiError(400, 'invalid_request', 'Use only limit, cursor and true/false interviewDone, retired, requiredTrainingsCompleted filters.');
    const pagination = parseCursorPagination(params, { defaultLimit: 50, maxLimit: 100 });
    if (pagination.error !== undefined) return apiError(400, 'invalid_request', pagination.error);
    const { limit, cursor } = pagination.data;
    const requirements = await prisma.training.findMany({ where: { requiredForNewPeople: true }, select: { id: true, requiresOrbatQualification: true } });
    const completedConditions: Prisma.UserWhereInput[] = requirements.map(training => ({ userTrainings: { some: { trainingId: training.id, status: { in: training.requiresOrbatQualification ? ['qualified'] : ['qualified', 'finished'] } } } }));
    const missingConditions: Prisma.UserWhereInput[] = requirements.map(training => ({ userTrainings: { none: { trainingId: training.id, status: { in: training.requiresOrbatQualification ? ['qualified'] : ['qualified', 'finished'] } } } }));
    const filters: Prisma.UserWhereInput[] = [{ OR: [{ userRank: null }, { userRank: { currentRankId: null } }, { userRank: { interviewDone: false } }, ...missingConditions] }];
    filters.push(userVisibility(principal));
    for (const key of ['interviewDone', 'retired'] as const) {
      if (params.get(key) === 'true') filters.push({ userRank: { [key]: true } });
      if (params.get(key) === 'false') filters.push({ OR: [{ userRank: null }, { userRank: { [key]: false } }] });
    }
    if (params.get('requiredTrainingsCompleted') === 'true') filters.push(...completedConditions);
    if (params.get('requiredTrainingsCompleted') === 'false') filters.push(missingConditions.length ? { OR: missingConditions } : { id: -1 });
    if (cursor) filters.push({ id: { gt: cursor } });
    const rows = await prisma.user.findMany({ where: { AND: filters }, orderBy: { id: 'asc' }, take: limit + 1, select: { id: true, username: true, userRank: { select: { interviewDone: true, retired: true } }, userTrainings: { where: { trainingId: { in: requirements.map(training => training.id) } }, select: { trainingId: true, status: true } } } });
    const data = await Promise.all(rows.slice(0, limit).map(async row => ({ id: row.id, username: row.username, userRank: row.userRank, attendanceTotal: await getCurrentAttendance(row.id), requiredTrainingsCompleted: requirements.every(training => row.userTrainings.some(entry => entry.trainingId === training.id && (entry.status === 'qualified' || entry.status === 'finished' && !training.requiresOrbatQualification))) })));
    const targetUserIds = data.filter(row => principal.kind === 'bot' || row.id !== principal.userId).map(row => row.id);
    if (targetUserIds.length) await writeApiAudit(prisma, context, { action: 'user_data.read', resource: 'user_onboarding', targetUserIds, outcome: 'success' });
    return apiSuccess(data, { meta: { limit, nextCursor: rows.length > limit ? String(data.at(-1)!.id) : null } });
  });
}
