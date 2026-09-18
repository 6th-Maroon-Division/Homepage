import { parseCursorPagination } from '@/lib/api/validation';
import { parseUtcTimestamp } from '@/lib/api/utc';
import { handleApiRequest } from '@/lib/api/handler';
import { apiError, apiSuccess } from '@/lib/api/response';
import { writeApiAudit } from '@/lib/api/audit';
import { isSessionStaff, sessionActor, sessionId as parseSessionId, validateSessionBody, sessionJson, safeSessionPublish, sessionDatabaseError, auditSessionRead, sessionSnapshot, attendeeSnapshot } from '@/lib/api/training-session-contract';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { assertEligibleTrainingStaff } from '@/lib/training-staff';
import { createSessionNotification, publishSessionNotifications, type SessionNotifications } from '@/lib/api/training-session-notifications';
import { publishTrainingChatEvent } from '@/lib/realtime/training-chat-events';
import { publishUserProfileEvent } from '@/lib/realtime/user-events';
import { appendBotEvent } from '@/lib/bot-events';
import { Prisma } from '@/generated/prisma/client';

const userSelect = { id: true, username: true, avatarUrl: true } as const;

type JsonObject = Record<string, unknown>;

class SessionConflictError extends Error {}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parsePositiveInteger(value: unknown): number | null { return typeof value === 'string' || typeof value === 'number' ? parseSessionId(String(value)) : null; }

export async function GET(request: Request) {
  return handleApiRequest(request, undefined, async (principal, audit) => {
    const staffViewer = isSessionStaff(principal);
    const viewerId = sessionActor(principal) ?? 0;
    const query = new URL(request.url).searchParams;
    if ([...query.keys()].some(key => !['limit', 'cursor', 'trainingId', 'trainerId', 'status', 'from', 'to'].includes(key) || query.getAll(key).length !== 1)) return apiError(400, 'invalid_request', 'Unknown or repeated query parameter.');
    const paging = parseCursorPagination(query, { defaultLimit: 50, maxLimit: 100 });
    if (paging.error) return apiError(400, 'invalid_request', paging.error);
    const { limit, cursor } = paging.data!;
    const trainingId = query.has('trainingId') ? parseSessionId(query.get('trainingId')!) : null;
    const trainerId = query.has('trainerId') ? parseSessionId(query.get('trainerId')!) : null;
    if (query.has('trainingId') && trainingId === null || query.has('trainerId') && trainerId === null) return apiError(400, 'invalid_request', 'Invalid training or trainer filter.');
    const status = query.get('status');
    if (status !== null && !['proposed', 'scheduled', 'in_progress', 'completed', 'cancelled'].includes(status)) return apiError(400, 'invalid_request', 'Invalid session status.');
    const from = query.has('from') ? parseUtcTimestamp(query.get('from')) : null;
    const to = query.has('to') ? parseUtcTimestamp(query.get('to')) : null;
    if (query.has('from') && !from || query.has('to') && !to || from && to && from >= to) return apiError(400, 'invalid_request', 'Provide zoned from/to timestamps with from before to.');
    if (!staffViewer && status && ['proposed', 'cancelled'].includes(status)) return apiSuccess([], { meta: { limit, nextCursor: null, isStaff: false } });
    const sessions = await prisma.trainingSession.findMany({
      where: {
        ...(!staffViewer ? { attendees: { some: { userId: viewerId, status: { not: 'cancelled' } } }, status: { notIn: ['proposed', 'cancelled'] } } : {}),
        ...(trainingId ? { trainingId } : {}), ...(trainerId ? { trainerId } : {}),
        ...(status ? { status: status as 'scheduled' } : {}),
        ...(cursor ? { id: { lt: cursor } } : {}),
        ...(from || to ? { startsAt: { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) } } : {}),
      },
      include: { training: true, trainer: { select: userSelect }, attendees: { ...(!staffViewer ? { where: { userId: viewerId, status: { not: 'cancelled' } } } : {}), include: { user: { select: userSelect }, trainingRequest: { select: { id: true, status: true } } } } },
      orderBy: { id: 'desc' }, take: limit + 1,
    });
    const page = sessions.slice(0, limit);
    await auditSessionRead(audit, page);
    return apiSuccess(page.map(item => ({ ...item, server: 'Arma3 Training Server' })), { meta: { limit, nextCursor: sessions.length > limit ? String(page[limit - 1].id) : null, isStaff: staffViewer } });
  });
}

export async function POST(request: Request) {
  return handleApiRequest(request, undefined, async (principal, audit) => {
    const invalid = await validateSessionBody(request, 'create');
    if (invalid) return invalid;
  const actorId = sessionActor(principal);
  if (!(isSessionStaff(principal))) {
    return sessionJson({ error: 'Forbidden' }, { status: 403 });
  }

  let parsedBody: unknown;
  try {
    parsedBody = await request.json();
  } catch {
    return sessionJson({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!isJsonObject(parsedBody)) {
    return sessionJson({ error: 'Request body must be an object' }, { status: 400 });
  }
  const body = parsedBody;
  const trainingId = parsePositiveInteger(body.trainingId);
  const trainerId = parsePositiveInteger(body.trainerId);
  if (!trainingId) {
    return sessionJson({ error: 'trainingId is required' }, { status: 400 });
  }
  if (!trainerId || !(await assertEligibleTrainingStaff(trainerId))) {
    return sessionJson({ error: 'Select an eligible trainer' }, { status: 400 });
  }

  if (body.attendeeUserIds !== undefined && !Array.isArray(body.attendeeUserIds)) {
    return sessionJson({ error: 'attendeeUserIds must be an array' }, { status: 400 });
  }
  const rawAttendeeUserIds = Array.isArray(body.attendeeUserIds) ? body.attendeeUserIds : [];
  const parsedAttendeeIds = rawAttendeeUserIds.map(parsePositiveInteger);
  if (parsedAttendeeIds.some((id) => id === null)) {
    return sessionJson({ error: 'Every attendee id must be a positive integer' }, { status: 400 });
  }
  const attendeeUserIds = Array.from(new Set(parsedAttendeeIds as number[]));
  const requestAssignments = (body.requestAssignments ?? []) as { userId: number; trainingRequestId: number }[];

  if (body.status !== undefined && body.status !== 'proposed' && body.status !== 'scheduled') {
    return sessionJson({ error: 'status must be proposed or scheduled' }, { status: 400 });
  }
  if (body.startsAt !== undefined && body.startsAt !== null && typeof body.startsAt !== 'string') {
    return sessionJson({ error: 'startsAt must be an ISO date string or null' }, { status: 400 });
  }
  const startsAt = typeof body.startsAt === 'string' && body.startsAt.trim()
    ? new Date(body.startsAt)
    : null;
  const confirmed = body.status === 'scheduled';
  if (typeof body.startsAt === 'string' && (!body.startsAt.trim() || Number.isNaN(startsAt?.getTime()))) {
    return sessionJson({ error: 'Invalid startsAt value' }, { status: 400 });
  }
  if (confirmed && !startsAt) {
    return sessionJson({ error: 'startsAt is required for a scheduled session' }, { status: 400 });
  }

  const training = await prisma.training.findUnique({ where: { id: trainingId } });
  if (!training) {
    return sessionJson({ error: 'Training not found' }, { status: 404 });
  }
  if (!training.isActive) {
    return sessionJson({ error: 'Inactive trainings cannot have new sessions' }, { status: 409 });
  }
  if (!training.requiresTrainingSession) {
    return sessionJson({ error: 'This training does not require a scheduled session' }, { status: 409 });
  }

  if (attendeeUserIds.length) {
    const existingUsers = await prisma.user.findMany({
      where: { id: { in: attendeeUserIds } },
      select: { id: true },
    });
    const existingIds = new Set(existingUsers.map((user) => user.id));
    const missingIds = attendeeUserIds.filter((userId) => !existingIds.has(userId));
    if (missingIds.length) {
      return sessionJson(
        { error: `Unknown attendee user id${missingIds.length === 1 ? '' : 's'}: ${missingIds.join(', ')}` },
        { status: 404 },
      );
    }
  }

  const hasExplicitDuration = body.durationMinutes !== undefined
    && body.durationMinutes !== null
    && body.durationMinutes !== '';
  const parsedDuration = hasExplicitDuration ? parsePositiveInteger(body.durationMinutes) : null;
  if (hasExplicitDuration && (parsedDuration === null || parsedDuration > 1440)) {
    return sessionJson({ error: 'Duration must be between 1 and 1440 minutes' }, { status: 400 });
  }
  const durationMinutes = hasExplicitDuration ? parsedDuration : training.duration;

  if (
    body.specialInstructions !== undefined
    && body.specialInstructions !== null
    && typeof body.specialInstructions !== 'string'
  ) {
    return sessionJson({ error: 'specialInstructions must be a string or null' }, { status: 400 });
  }

  const notifications: SessionNotifications = [];
  let created;
  try {
    created = await prisma.$transaction(async (tx) => {
      const currentTraining = await tx.training.findUnique({ where: { id: trainingId } });
      if (!currentTraining) return { error: apiError(404, 'not_found', 'Training not found.') };
      if (!currentTraining.isActive || !currentTraining.requiresTrainingSession) throw new SessionConflictError('Training no longer accepts scheduled sessions.');
      const eligibleTrainer = await tx.userPermission.findFirst({ where: { userId: trainerId, value: { gt: 0 }, permission: { key: { in: ['training:approve_request', 'training:mark', 'system:super_admin'] } } }, select: { id: true } });
      if (!eligibleTrainer) throw new SessionConflictError('The selected trainer is no longer eligible.');
      const users = await tx.user.findMany({ where: { id: { in: attendeeUserIds } }, select: { id: true } });
      if (users.length !== attendeeUserIds.length) throw new SessionConflictError('One or more attendees no longer exist.');
      const linkableRequests = attendeeUserIds.length
        ? await tx.trainingRequest.findMany({
            where: {
              trainingId,
              userId: { in: attendeeUserIds },
              status: { in: ['pending', 'approved', 'in_training'] },
            },
            select: {
              id: true,
              userId: true,
              status: true,
              sessionAttendee: { select: { id: true, sessionId: true, status: true, session: { select: { status: true } } } },
            },
            orderBy: [{ requestedAt: 'desc' }, { id: 'desc' }],
          })
        : [];
      const activeRequestByUserId = new Map<number, (typeof linkableRequests)[number]>();
      for (const trainingRequest of linkableRequests) {
        if (!activeRequestByUserId.has(trainingRequest.userId)) {
          activeRequestByUserId.set(trainingRequest.userId, trainingRequest);
        }
      }
      if (requestAssignments.length) {
        const selected = await tx.trainingRequest.findMany({ where: { id: { in: requestAssignments.map(item => item.trainingRequestId) } }, select: { id: true, userId: true, trainingId: true, status: true, sessionAttendee: { select: { id: true, sessionId: true, status: true, session: { select: { status: true } } } } } });
        if (selected.length !== requestAssignments.length) return { error: apiError(404, 'not_found', 'One or more selected training requests do not exist.') };
        for (const assignment of requestAssignments) {
          const selectedRequest = selected.find(item => item.id === assignment.trainingRequestId)!;
          if (selectedRequest.userId !== assignment.userId || selectedRequest.trainingId !== trainingId || !['pending', 'approved', 'in_training'].includes(selectedRequest.status)) throw new SessionConflictError('The selected request must be active and belong to the attendee and training.');
          activeRequestByUserId.set(assignment.userId, selectedRequest);
        }
      }
      for (const trainingRequest of activeRequestByUserId.values()) {
        if (trainingRequest.sessionAttendee && (trainingRequest.sessionAttendee.status === 'cancelled' || trainingRequest.sessionAttendee.session.status === 'cancelled')) {
          const released = await tx.trainingSessionAttendee.updateMany({ where: { id: trainingRequest.sessionAttendee.id, trainingRequestId: trainingRequest.id }, data: { trainingRequestId: null, reminder24hSentAt: null } });
          if (released.count !== 1) throw new SessionConflictError('The previous request assignment changed concurrently.');
          trainingRequest.sessionAttendee = null;
        }

        if (trainingRequest.sessionAttendee) {
          throw new SessionConflictError(
            `Training Request #${trainingRequest.id} is already linked to another session`,
          );
        }
        if (confirmed && trainingRequest.status === 'pending') {
          throw new SessionConflictError(
            `Training Request #${trainingRequest.id} must be approved before its session is confirmed`,
          );
        }
      }
      const requestByUserId = new Map(
        Array.from(activeRequestByUserId, ([userId, trainingRequest]) => [userId, trainingRequest.id]),
      );

      const conflictingAttendances = attendeeUserIds.length
        ? await tx.trainingSessionAttendee.findMany({
            where: {
              userId: { in: attendeeUserIds },
              status: { not: 'cancelled' },
              session: {
                trainingId,
                status: { in: ['proposed', 'scheduled', 'in_progress'] },
              },
            },
            select: { userId: true, sessionId: true },
          })
        : [];
      if (conflictingAttendances.length) {
        const conflict = conflictingAttendances[0];
        throw new SessionConflictError(
          `User ${conflict.userId} is already assigned to open Training Session #${conflict.sessionId}`,
        );
      }

      const trainingSession = await tx.trainingSession.create({
        data: {
          trainingId,
          trainerId,
          createdById: actorId,
          startsAt,
          durationMinutes,
          status: confirmed ? 'scheduled' : 'proposed',
          specialInstructions: typeof body.specialInstructions === 'string'
            ? body.specialInstructions.trim().slice(0, 4000) || null
            : null,
          attendees: attendeeUserIds.length
            ? {
                create: attendeeUserIds.map((userId) => ({
                  userId,
                  trainingRequestId: requestByUserId.get(userId),
                })),
              }
            : undefined,
        },
        include: {
          training: true,
          trainer: { select: userSelect },
          attendees: {
            include: {
              user: { select: userSelect },
              trainingRequest: { select: { id: true, status: true } },
            },
          },
        },
      });

      const linkedRequestIds = Array.from(requestByUserId.values());
      if (linkedRequestIds.length) {
        await tx.trainingRequest.updateMany({
          where: { id: { in: linkedRequestIds } },
          data: { assignedTrainerId: trainerId },
        });
        await tx.trainingRequestSubscription.createMany({
          data: linkedRequestIds.map((requestId) => ({
            requestId,
            userId: trainerId,
            websiteEnabled: true,
            discordEnabled: false,
          })),
          skipDuplicates: true,
        });
        const auditBody = confirmed && startsAt
          ? `Added to Training Session #${trainingSession.id}, scheduled for ${startsAt.toISOString()} on the Arma3 Training Server.`
          : `Added to draft Training Session #${trainingSession.id}. Staff will confirm the date and trainer.`;
        await tx.trainingRequestMessage.createMany({
          data: linkedRequestIds.map((requestId) => ({
            requestId,
            senderRole: 'SYSTEM' as const,
            body: auditBody,
          })),
        });
      }
  if (confirmed && startsAt && attendeeUserIds.length) {
    await createSessionNotification({
      recipientUserIds: attendeeUserIds,
      title: `${training.name} training scheduled`,
      body: `Your training is scheduled for ${startsAt.toLocaleString('en-GB', { timeZone: 'UTC' })} UTC on the Arma3 Training Server.`,
      actionUrl: '/profile?tab=trainings',
      createdById: actorId,
    }, tx, notifications);
  }
  if (confirmed && startsAt) {
    await appendBotEvent({ type: 'training.scheduled', aggregate: 'training', aggregateId: trainingSession.id, payload: {
      trainingId: trainingSession.trainingId, sessionId: trainingSession.id,
      title: trainingSession.training.name, startsAt: startsAt.toISOString(),
      endsAt: trainingSession.durationMinutes === null ? null : new Date(startsAt.getTime() + trainingSession.durationMinutes * 60_000).toISOString(),
      websiteUrl: `/trainings/sessions/${trainingSession.id}`, version: trainingSession.updatedAt.toISOString(),
    } }, tx);
  }
      await writeApiAudit(tx, audit, { action: 'training_session.created', resource: 'training_session', resourceId: String(trainingSession.id), targetUserIds: attendeeUserIds, outcome: 'success', after: sessionSnapshot(trainingSession) });
      return { trainingSession, linkedRequestIds };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof SessionConflictError) {
      return sessionJson({ error: error.message }, { status: 409 });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return sessionJson(
        { error: 'One or more attendees were linked to another training session at the same time' },
        { status: 409 },
      );
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
      return sessionJson(
        { error: 'The session or attendee list changed concurrently. Refresh and try again.' },
        { status: 409 },
      );
    }
    return sessionDatabaseError(error);
  }

  if ('error' in created) return created.error!;
  publishSessionNotifications(notifications);
  for (const userId of attendeeUserIds) {
    safeSessionPublish(() => publishUserProfileEvent(userId, {
      source: 'training-session.created',
      sessionId: created.trainingSession.id,
    }));
  }
  for (const requestId of created.linkedRequestIds) {
    safeSessionPublish(() => publishTrainingChatEvent(requestId, {
      source: 'schedule',
      sessionId: created.trainingSession.id,
      confirmed,
    }));
  }


  return sessionJson(
    { ...created.trainingSession, server: 'Arma3 Training Server' },
    { status: 201 },
  );
  });
}
