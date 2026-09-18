import { handleApiRequest } from '@/lib/api/handler';
import { apiError, apiSuccess } from '@/lib/api/response';
import { writeApiAudit } from '@/lib/api/audit';
import { isSessionStaff, sessionActor, sessionId as parseSessionId, validateSessionBody, sessionJson, safeSessionPublish, sessionDatabaseError, auditSessionRead, sessionSnapshot, attendeeSnapshot } from '@/lib/api/training-session-contract';
import { NextResponse } from 'next/server';
import { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import { publishTrainingChatEvent } from '@/lib/realtime/training-chat-events';
import { publishUserProfileEvent } from '@/lib/realtime/user-events';
import { createSessionNotification, publishSessionNotifications, type SessionNotifications } from '@/lib/api/training-session-notifications';

type RouteContext = { params: Promise<{ id: string; attendeeId: string }> };
type JsonObject = Record<string, unknown>;
type AttendeeStatus = 'scheduled' | 'attended' | 'completed' | 'absent' | 'cancelled';

const ATTENDEE_STATUSES: readonly AttendeeStatus[] = [
  'scheduled',
  'attended',
  'completed',
  'absent',
  'cancelled',
];
const userSelect = { id: true, username: true, avatarUrl: true } as const;

class AttendeeApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAttendeeStatus(value: unknown): value is AttendeeStatus {
  return typeof value === 'string' && (ATTENDEE_STATUSES as readonly string[]).includes(value);
}

function parsePositiveInteger(value: unknown): number | null { return typeof value === 'string' || typeof value === 'number' ? parseSessionId(String(value)) : null; }

function isStatusAllowedForSession(sessionStatus: string, attendeeStatus: AttendeeStatus) {
  if (sessionStatus === 'cancelled') return attendeeStatus === 'cancelled';
  if (sessionStatus === 'proposed') return attendeeStatus === 'scheduled' || attendeeStatus === 'cancelled';
  if (sessionStatus === 'completed') return attendeeStatus !== 'scheduled';
  return true;
}

async function readBody(request: Request, required: boolean): Promise<JsonObject | NextResponse> {
  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return sessionJson({ error: 'Unable to read request body' }, { status: 400 });
  }
  if (!rawBody.trim()) {
    return required
      ? sessionJson({ error: 'Request body is required' }, { status: 400 })
      : {};
  }
  try {
    const parsed: unknown = JSON.parse(rawBody);
    return isJsonObject(parsed)
      ? parsed
      : sessionJson({ error: 'Request body must be an object' }, { status: 400 });
  } catch {
    return sessionJson({ error: 'Invalid JSON body' }, { status: 400 });
  }
}

async function mutateAttendee(
  request: Request,
  context: RouteContext,
  forcedStatus?: AttendeeStatus,
) {
  return handleApiRequest(request, undefined, async (principal, audit) => {
    const path = await context.params;
    if (!parseSessionId(path.id) || !parseSessionId(path.attendeeId)) return apiError(400, 'invalid_request', 'Invalid session or attendee ID.');

    const invalid = await validateSessionBody(request, forcedStatus ? 'remove' : 'attendee');
    if (invalid) return invalid;
  const actorId = sessionActor(principal);
  if (!(isSessionStaff(principal))) {
    return sessionJson({ error: 'Forbidden' }, { status: 403 });
  }

  const { id, attendeeId: rawAttendeeId } = await context.params;
  const sessionId = parsePositiveInteger(id);
  const attendeeId = parsePositiveInteger(rawAttendeeId);
  if (!sessionId || !attendeeId) {
    return sessionJson({ error: 'Invalid session or attendee id' }, { status: 400 });
  }

  const bodyResult = await readBody(request, forcedStatus === undefined);
  if (bodyResult instanceof NextResponse) return bodyResult;
  const body = bodyResult;
  const targetStatus = forcedStatus ?? body.status;
  if (!isAttendeeStatus(targetStatus)) {
    return sessionJson({ error: 'Valid attendance status is required' }, { status: 400 });
  }
  if (body.notes !== undefined && body.notes !== null && typeof body.notes !== 'string') {
    return sessionJson({ error: 'notes must be a string or null' }, { status: 400 });
  }
  if (body.expectedUpdatedAt !== undefined && typeof body.expectedUpdatedAt !== 'string') {
    return sessionJson({ error: 'expectedUpdatedAt must be an ISO date string' }, { status: 400 });
  }
  const expectedUpdatedAt = typeof body.expectedUpdatedAt === 'string'
    ? new Date(body.expectedUpdatedAt)
    : null;
  if (expectedUpdatedAt && Number.isNaN(expectedUpdatedAt.getTime())) {
    return sessionJson({ error: 'Invalid expectedUpdatedAt value' }, { status: 400 });
  }
  const hasNotes = Object.prototype.hasOwnProperty.call(body, 'notes');
  const notes = typeof body.notes === 'string' ? body.notes.trim().slice(0, 4000) || null : null;

  const notifications: SessionNotifications = [];
  try {
    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.trainingSessionAttendee.findFirst({
        where: { id: attendeeId, sessionId },
        include: {
          user: { select: userSelect },
          session: { include: { training: true } },
          trainingRequest: {
            select: {
              id: true,
              userId: true,
              trainingId: true,
              status: true,
              updatedAt: true,
            },
          },
        },
      });
      if (!existing) {
        throw new AttendeeApiError('Training session attendee not found', 404);
      }
      if (
        existing.trainingRequest
        && (
          existing.trainingRequest.userId !== existing.userId
          || existing.trainingRequest.trainingId !== existing.session.trainingId
        )
      ) {
        throw new AttendeeApiError('Linked training request does not match this attendee and training', 409);
      }
      if (expectedUpdatedAt && existing.updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
        throw new AttendeeApiError('Attendee changed since it was loaded. Refresh and try again.', 409);
      }
      if (!isStatusAllowedForSession(existing.session.status, targetStatus)) {
        throw new AttendeeApiError(
          `Attendance status ${targetStatus} is not valid for a ${existing.session.status} session`,
          409,
        );
      }

      if (existing.status === 'cancelled' && targetStatus !== 'cancelled') {
        const conflict = await tx.trainingSessionAttendee.findFirst({ where: { id: { not: attendeeId }, userId: existing.userId, status: { not: 'cancelled' }, session: { trainingId: existing.session.trainingId, status: { in: ['proposed', 'scheduled', 'in_progress'] } } }, select: { id: true } });
        if (conflict) throw new AttendeeApiError('User is already assigned to another open training session.', 409);
      }
      const now = new Date();
      const updateResult = await tx.trainingSessionAttendee.updateMany({
        where: { id: attendeeId, sessionId, updatedAt: existing.updatedAt },
        data: {
          status: targetStatus,
          ...(hasNotes ? { notes } : {}),
          ...(targetStatus === 'attended' || targetStatus === 'completed'
            ? { attendedAt: existing.attendedAt ?? now }
            : {}),
          ...(targetStatus === 'completed' ? { completedAt: existing.completedAt ?? now } : {}),
        },
      });
      if (updateResult.count !== 1) {
        throw new AttendeeApiError('Attendee changed while it was being updated. Refresh and try again.', 409);
      }

      let attendee = await tx.trainingSessionAttendee.findUniqueOrThrow({
        where: { id: attendeeId },
        include: {
          user: { select: userSelect },
          trainingRequest: { select: { id: true, status: true } },
        },
      });

      if (existing.trainingRequest && (existing.status !== targetStatus || hasNotes)) {
        const auditText = existing.status !== targetStatus
          ? `Attendance for Training Session #${sessionId} changed from ${existing.status} to ${targetStatus}.`
          : `Attendance notes for Training Session #${sessionId} were updated.`;
        await tx.trainingRequestMessage.create({
          data: {
            requestId: existing.trainingRequest.id,
            senderRole: 'SYSTEM',
            body: auditText,
          },
        });
      }

      let requestStarted = false;
      if (
        existing.trainingRequest?.status === 'approved'
        && (targetStatus === 'attended' || targetStatus === 'completed')
      ) {
        const requestUpdate = await tx.trainingRequest.updateMany({
          where: {
            id: existing.trainingRequest.id,
            status: 'approved',
            updatedAt: existing.trainingRequest.updatedAt,
          },
          data: { status: 'in_training', handledByAdminId: actorId },
        });
        if (requestUpdate.count !== 1) {
          throw new AttendeeApiError(
            'The linked training request changed while attendance was being recorded. Refresh and try again.',
            409,
          );
        }

        const previousCredential = await tx.userTraining.findUnique({
          where: {
            userId_trainingId: {
              userId: existing.userId,
              trainingId: existing.session.trainingId,
            },
          },
        });
        let userTrainingId: number;
        if (previousCredential) {
          if (previousCredential.status === 'approved') {
            const credentialUpdate = await tx.userTraining.updateMany({
              where: {
                id: previousCredential.id,
                status: 'approved',
                statusUpdatedAt: previousCredential.statusUpdatedAt,
              },
              data: {
                status: 'in_training',
                needsRetraining: false,
                trainerId: existing.session.trainerId ?? actorId,
                statusUpdatedAt: now,
                orbatQualifiedAt: null,
                failedAt: null,
              },
            });
            if (credentialUpdate.count !== 1) {
              throw new AttendeeApiError(
                'The linked training record changed while attendance was being recorded. Refresh and try again.',
                409,
              );
            }
          } else if (previousCredential.status !== 'in_training') {
            throw new AttendeeApiError(
              `The linked training record is ${previousCredential.status} and cannot be started from attendance.`,
              409,
            );
          }
          userTrainingId = previousCredential.id;
        } else {
          const credential = await tx.userTraining.create({
            data: {
              userId: existing.userId,
              trainingId: existing.session.trainingId,
              trainerId: existing.session.trainerId ?? actorId,
              status: 'in_training',
              needsRetraining: false,
              statusUpdatedAt: now,
            },
          });
          userTrainingId = credential.id;
        }

        if (previousCredential?.status !== 'in_training') {
          await tx.userTrainingStatusHistory.create({
            data: {
              userTrainingId,
              fromStatus: previousCredential?.status ?? null,
              toStatus: 'in_training',
              changedById: actorId,
              trainingSessionId: sessionId,
              notes: `Attendance was recorded for Training Session #${sessionId}.`,
            },
          });
        }
        await tx.trainingRequestMessage.create({
          data: {
            requestId: existing.trainingRequest.id,
            senderRole: 'SYSTEM',
            body: 'Attendance was recorded. Status changed from approved to in training.',
          },
        });
        requestStarted = true;
      }

      attendee = await tx.trainingSessionAttendee.findUniqueOrThrow({ where: { id: attendeeId }, include: { user: { select: userSelect }, trainingRequest: { select: { id: true, status: true } } } });

    if (existing.status !== targetStatus) {
      const notificationText: Record<AttendeeStatus, string> = {
        scheduled: 'You are listed as scheduled for this session.',
        attended: 'Your attendance was recorded. This does not change your qualification status.',
        completed: 'Your session attendance was marked complete. Qualification remains a separate trainer action.',
        absent: 'You were marked absent from this session.',
        cancelled: 'You were removed from this training session.',
      };
      await createSessionNotification({
        recipientUserIds: [attendee.userId],
        title: `${existing.session.training.name}: attendance updated`,
        body: notificationText[targetStatus],
        actionUrl: existing.trainingRequest?.id
          ? `/trainings/requests/${existing.trainingRequest?.id}`
          : '/profile?tab=trainings',
        createdById: actorId,
      }, tx, notifications);
    }

      await writeApiAudit(tx, audit, { action: 'training_session_attendee.updated', resource: 'training_session_attendee', resourceId: String(attendee.id), targetUserIds: [existing.userId], outcome: 'success', before: attendeeSnapshot(existing), after: attendeeSnapshot(attendee) });
      return {
        attendee,
        previousStatus: existing.status,
        linkedRequestId: existing.trainingRequest?.id ?? null,
        trainingName: existing.session.training.name,
        requestStarted,
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  publishSessionNotifications(notifications);
    safeSessionPublish(() => publishUserProfileEvent(result.attendee.userId, {
      source: 'training-session.attendee-updated',
      sessionId,
      attendeeId,
      status: targetStatus,
    }));
    if (result.linkedRequestId) {
      safeSessionPublish(() => publishTrainingChatEvent(result.linkedRequestId!, {
        source: 'session-attendee',
        sessionId,
        attendeeId,
        status: targetStatus,
      }));
    }

    return sessionJson({
      attendee: result.attendee,
      removed: forcedStatus === 'cancelled',
    });
  } catch (error) {
    if (error instanceof AttendeeApiError) {
      return sessionJson({ error: error.message }, { status: error.status });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
      return sessionJson(
        { error: 'The attendee changed concurrently. Refresh and try again.' },
        { status: 409 },
      );
    }
    return sessionDatabaseError(error);
  }
  });
}

export async function PATCH(request: Request, context: RouteContext) {
  return mutateAttendee(request, context);
}

export async function DELETE(request: Request, context: RouteContext) {
  return mutateAttendee(request, context, 'cancelled');
}
