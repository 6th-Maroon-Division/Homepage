import { prisma } from '@/lib/prisma';
import type { ApiPrincipal } from './principal';
import { hasApiPermission } from './permissions';
import { TRAINING_STAFF_PERMISSION_KEYS } from '@/lib/training-staff';
import { parsePositiveId } from './validation';
export type CalendarPagination = { limit: number; cursor: string | null };
export type CalendarItem = { id: number; kind: 'orbat'; name: string; description: string | null; eventDate: string; startsAtUtc: string | null; dateKey: string; href: string; isSideOp: boolean } | { id: number; kind: 'training_session'; name: string; description: string; eventDate: string; startsAtUtc: string | null; dateKey: string; href: string; status: string; trainerName: string | null };
export function parseCalendarPagination(params: URLSearchParams): { data: CalendarPagination; error?: never } | { error: string; data?: never } {
  if ([...params.keys()].some(key => !['limit', 'cursor'].includes(key) || params.getAll(key).length !== 1)) return { error: 'Use only one limit and cursor parameter.' };
  const limit = params.has('limit') ? parsePositiveId(params.get('limit')) : 50;
  if (!limit) return { error: 'limit must be a positive integer.' };
  const cursor = params.get('cursor');
  if (cursor !== null) {
    const match = /^(orbat|training_session):([1-9]\d*)$/.exec(cursor);
    if (!match || !parsePositiveId(match[2]) || Number(match[2]) > 2147483647) return { error: 'cursor must be orbat:<id> or training_session:<id> with a positive 32-bit integer id.' };
  }
  return { data: { limit: Math.min(limit, 100), cursor } };
}
export async function getCalendarPage(principal: ApiPrincipal | null, pagination: CalendarPagination): Promise<{ data: CalendarItem[]; meta: { limit: number; nextCursor: string | null }; targetUserIds: number[] }> {
  const { limit, cursor } = pagination;
  const [cursorKind, cursorId] = cursor?.split(':') ?? [];
  const data: CalendarItem[] = [];
  if (cursorKind !== 'training_session') {
    const orbats = await prisma.orbat.findMany({ where: cursorKind === 'orbat' ? { id: { lt: Number(cursorId) } } : {}, select: { id: true, name: true, description: true, startsAtUtc: true, eventDate: true, createdAt: true, isSideOp: true }, orderBy: { id: 'desc' }, take: limit + 1 });
    for (const orbat of orbats) {
      const date = (orbat.startsAtUtc ?? orbat.eventDate ?? orbat.createdAt).toISOString();
      data.push({ id: orbat.id, kind: 'orbat', name: orbat.name, description: orbat.description, eventDate: date, startsAtUtc: orbat.startsAtUtc?.toISOString() ?? null, dateKey: date.slice(0, 10), href: `/orbats/${orbat.id}`, isSideOp: orbat.isSideOp });
    }
  }
  const trainers: { itemId: number; userId: number }[] = [];
  if (principal && data.length <= limit) {
    const staff = TRAINING_STAFF_PERMISSION_KEYS.some(permission => hasApiPermission(principal.permissions, permission));
    const userId = principal.kind === 'user' ? principal.userId : -1;
    const sessions = await prisma.trainingSession.findMany({
      where: { startsAt: { not: null }, ...(cursorKind === 'training_session' ? { id: { lt: Number(cursorId) } } : {}), ...(staff ? {} : { status: { notIn: ['proposed', 'cancelled'] }, attendees: { some: { userId, status: { not: 'cancelled' } } } }) },
      select: { id: true, startsAt: true, status: true, training: { select: { name: true } }, trainer: { select: { id: true, username: true } }, attendees: { where: { userId, status: { not: 'cancelled' }, trainingRequestId: { not: null } }, orderBy: { id: 'asc' }, take: 1, select: { trainingRequestId: true } } },
      orderBy: { id: 'desc' }, take: limit - data.length + 1,
    });
    for (const session of sessions) {
      const date = session.startsAt!.toISOString();
      const requestId = session.attendees[0]?.trainingRequestId;
      data.push({ id: session.id, kind: 'training_session', name: `${session.training.name} Training`, description: [session.status.replaceAll('_', ' '), session.trainer?.username ? `Trainer: ${session.trainer.username}` : null, 'Arma3 Training Server'].filter(Boolean).join(' · '), eventDate: date, startsAtUtc: date, dateKey: date.slice(0, 10), status: session.status, trainerName: session.trainer?.username ?? null, href: staff ? `/admin/trainings?tab=sessions&session=${session.id}` : requestId ? `/trainings/requests/${requestId}` : '/profile?tab=trainings' });
      if (session.trainer?.username) trainers.push({ itemId: session.id, userId: session.trainer.id });
    }
  }
  const page = data.slice(0, limit);
  const sessionIds = new Set(page.filter(item => item.kind === 'training_session').map(item => item.id));
  const targetUserIds = [...new Set(trainers.filter(trainer => sessionIds.has(trainer.itemId) && (principal?.kind !== 'user' || principal.userId !== trainer.userId)).map(trainer => trainer.userId))];
  const last = page.at(-1);
  return { data: page, meta: { limit, nextCursor: data.length > limit && last ? `${last.kind}:${last.id}` : null }, targetUserIds };
}
export async function getCalendarItems(principal: ApiPrincipal | null): Promise<CalendarItem[]> {
  const items: CalendarItem[] = [];
  let cursor: string | null = null;
  do {
    const page = await getCalendarPage(principal, { limit: 100, cursor });
    items.push(...page.data); cursor = page.meta.nextCursor;
  } while (cursor);
  return items;
}
