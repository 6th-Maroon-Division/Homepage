import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import { publishTrainingChatEvent } from '@/lib/realtime/training-chat-events';
import { publishUserProfileEvent } from '@/lib/realtime/user-events';
import { createTrainingNotification } from '@/lib/training-notifications';
import { isTrainingStaff } from '@/lib/training-staff';

type RouteContext = { params: Promise<{ id: string }> };
type JsonObject = Record<string, unknown>;

const userSelect = { id: true, username: true, avatarUrl: true } as const;
const ACTIVE_REQUEST_STATUSES = ['pending', 'approved', 'in_training'] as const;
const OPEN_SESSION_STATUSES = ['proposed', 'scheduled', 'in_progress'] as const;

class AttendeeApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parsePositiveInteger(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const normalized = typeof value === 'string' ? value.trim() : value;
  if (typeof normalized === 'string' && !/^\d+$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export async function POST(request: NextRequest, context: RouteContext) {
  const authSession = await getServerSession(authOptions);
  if (!authSession?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const actorId = Number(authSession.user.id);
  if (!(await isTrainingStaff(actorId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id } = await context.params;
  const sessionId = parsePositiveInteger(id);
  if (!sessionId) {
    return NextResponse.json({ error: 'Invalid training session id' }, { status: 400 });
  }

  let parsedBody: unknown;
  try {
    parsedBody = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!isJsonObject(parsedBody)) {
    return NextResponse.json({ error: 'Request body must be an object' }, { status: 400 });
  }
  const body = parsedBody;
  const userId = parsePositiveInteger(body.userId);
  if (!userId) {
    return NextResponse.json({ error: 'userId must be a positive integer' }, { status: 400 });
  }

  const hasExplicitRequest = Object.prototype.hasOwnProperty.call(body, 'trainingRequestId');
  const trainingRequestId = body.trainingRequestId === null || body.trainingRequestId === undefined
    ? null
    : parsePositiveInteger(body.trainingRequestId);
  if (hasExplicitRequest && body.trainingRequestId !== null && !trainingRequestId) {
    return NextResponse.json({ error: 'trainingRequestId must be a positive integer or null' }, { status: 400 });
  }
  if (body.notes !== undefined && body.notes !== null && typeof body.notes !== 'string') {
    return NextResponse.json({ error: 'notes must be a string or null' }, { status: 400 });
  }
  const notes = typeof body.notes === 'string' ? body.notes.trim().slice(0, 4000) || null : null;
  if (body.advanceTraining !== undefined && typeof body.advanceTraining !== 'boolean') {
    return NextResponse.json({ error: 'advanceTraining must be a boolean' }, { status: 400 });
  }
  const advanceTraining = body.advanceTraining === true;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const trainingSession = await tx.trainingSession.findUnique({
        where: { id: sessionId },
        include: { training: true, trainer: { select: userSelect } },
      });
      if (!trainingSession) {
        throw new AttendeeApiError('Training session not found', 404);
      }
      if (!(OPEN_SESSION_STATUSES as readonly string[]).includes(trainingSession.status)) {
        throw new AttendeeApiError('Attendees cannot be added to a completed or cancelled session', 409);
      }
      if (!trainingSession.training.isActive && trainingSession.status !== 'in_progress') {
        throw new AttendeeApiError('Attendees cannot be added to an inactive training', 409);
      }

      const user = await tx.user.findUnique({ where: { id: userId }, select: userSelect });
      if (!user) {
        throw new AttendeeApiError('User not found', 404);
      }

      const existingAttendee = await tx.trainingSessionAttendee.findUnique({
        where: { sessionId_userId: { sessionId, userId } },
      });
      if (existingAttendee) {
        throw new AttendeeApiError(
          existingAttendee.status === 'cancelled'
            ? 'This attendee already exists as cancelled; update their status to restore them'
            : 'User is already an attendee of this session',
          409,
        );
      }

      const otherOpenAttendance = await tx.trainingSessionAttendee.findFirst({
        where: {
          userId,
          status: { not: 'cancelled' },
          session: {
            trainingId: trainingSession.trainingId,
            status: { in: [...OPEN_SESSION_STATUSES] },
          },
        },
        select: { sessionId: true },
      });
      if (otherOpenAttendance) {
        throw new AttendeeApiError(
          `User is already assigned to open Training Session #${otherOpenAttendance.sessionId}`,
          409,
        );
      }

      let linkedRequest = hasExplicitRequest
        ? trainingRequestId
          ? await tx.trainingRequest.findUnique({
              where: { id: trainingRequestId },
              include: { sessionAttendee: { select: { id: true, sessionId: true, status: true } } },
            })
          : null
        : await tx.trainingRequest.findFirst({
            where: {
              userId,
              trainingId: trainingSession.trainingId,
              status: { in: [...ACTIVE_REQUEST_STATUSES] },
            },
            include: { sessionAttendee: { select: { id: true, sessionId: true, status: true } } },
            orderBy: [{ requestedAt: 'desc' }, { id: 'desc' }],
          });

      if (!linkedRequest && advanceTraining) {
        linkedRequest = await tx.trainingRequest.create({
          data: {
            userId,
            trainingId: trainingSession.trainingId,
            status: 'pending',
            subscriptions: {
              create: { userId, websiteEnabled: true, discordEnabled: false },
            },
          },
          include: { sessionAttendee: { select: { id: true, sessionId: true, status: true } } },
        });
      }

      if (trainingRequestId && !linkedRequest) {
        throw new AttendeeApiError('Training request not found', 404);
      }
      if (linkedRequest) {
        if (linkedRequest.userId !== userId || linkedRequest.trainingId !== trainingSession.trainingId) {
          throw new AttendeeApiError('Training request does not belong to this user and training', 409);
        }
        if (!(ACTIVE_REQUEST_STATUSES as readonly string[]).includes(linkedRequest.status)) {
          throw new AttendeeApiError('Only active training requests can be linked to a session', 409);
        }
        if (linkedRequest.sessionAttendee) {
          if (linkedRequest.sessionAttendee.status !== 'cancelled') {
            throw new AttendeeApiError(
              `Training request is already linked to Training Session #${linkedRequest.sessionAttendee.sessionId}`,
              409,
            );
          }
          await tx.trainingSessionAttendee.update({
            where: { id: linkedRequest.sessionAttendee.id },
            data: { trainingRequestId: null },
          });
        }
        if (linkedRequest.status === 'pending' && trainingSession.status !== 'proposed' && !advanceTraining) {
          throw new AttendeeApiError('Approve the training request before adding it to a confirmed session', 409);
        }
      }

      const attendee = await tx.trainingSessionAttendee.create({
        data: {
          sessionId,
          userId,
          trainingRequestId: linkedRequest?.id,
          status: 'scheduled',
          notes,
        },
        include: {
          user: { select: userSelect },
          trainingRequest: { select: { id: true, status: true } },
        },
      });

      if (linkedRequest) {
        const automaticStart = trainingSession.status === 'in_progress'
          && linkedRequest.status === 'approved';
        const advancedStatus = advanceTraining
          ? linkedRequest.status === 'pending'
            ? 'approved' as const
            : linkedRequest.status === 'approved'
              ? 'in_training' as const
              : linkedRequest.status
          : automaticStart ? 'in_training' as const : linkedRequest.status;
        const progressesRequest = advancedStatus !== linkedRequest.status;
        if (trainingSession.trainerId || progressesRequest) {
          const requestUpdate = await tx.trainingRequest.updateMany({
            where: {
              id: linkedRequest.id,
              status: linkedRequest.status,
              updatedAt: linkedRequest.updatedAt,
            },
            data: {
              ...(trainingSession.trainerId
                ? { assignedTrainerId: trainingSession.trainerId }
                : {}),
              ...(progressesRequest ? { status: advancedStatus, handledByAdminId: actorId } : {}),
            },
          });
          if (requestUpdate.count !== 1) {
            throw new AttendeeApiError(
              'The training request changed while the attendee was being added. Refresh and try again.',
              409,
            );
          }
        }
        if (trainingSession.trainerId) {
          await tx.trainingRequestSubscription.upsert({
            where: {
              requestId_userId: {
                requestId: linkedRequest.id,
                userId: trainingSession.trainerId,
              },
            },
            create: {
              requestId: linkedRequest.id,
              userId: trainingSession.trainerId,
              websiteEnabled: true,
              discordEnabled: false,
            },
            update: {},
          });
        }
        if (progressesRequest) {
          const credentialStatus = advancedStatus === 'in_training' ? 'in_training' as const : 'approved' as const;
          const progressTime = new Date();
          const previousCredential = await tx.userTraining.findUnique({
            where: {
              userId_trainingId: {
                userId,
                trainingId: trainingSession.trainingId,
              },
            },
          });
          let userTrainingId: number;
          if (previousCredential) {
            if (credentialStatus === 'in_training' && previousCredential.status === 'approved') {
              const credentialUpdate = await tx.userTraining.updateMany({
                where: {
                  id: previousCredential.id,
                  status: 'approved',
                  statusUpdatedAt: previousCredential.statusUpdatedAt,
                },
                data: {
                  status: 'in_training',
                  needsRetraining: false,
                  trainerId: trainingSession.trainerId ?? actorId,
                  statusUpdatedAt: progressTime,
                  orbatQualifiedAt: null,
                  failedAt: null,
                },
              });
              if (credentialUpdate.count !== 1) {
                throw new AttendeeApiError(
                  'The training record changed while the attendee was being added. Refresh and try again.',
                  409,
                );
              }
            } else if (previousCredential.status !== credentialStatus) {
              throw new AttendeeApiError(
                `The training record is ${previousCredential.status} and cannot move to ${credentialStatus}.`,
                409,
              );
            }
            userTrainingId = previousCredential.id;
          } else {
            const credential = await tx.userTraining.create({
              data: {
                userId,
                trainingId: trainingSession.trainingId,
                trainerId: trainingSession.trainerId ?? actorId,
                status: credentialStatus,
                needsRetraining: false,
                statusUpdatedAt: progressTime,
              },
            });
            userTrainingId = credential.id;
          }
          if (previousCredential?.status !== credentialStatus) {
            await tx.userTrainingStatusHistory.create({
              data: {
                userTrainingId,
                fromStatus: previousCredential?.status ?? null,
                toStatus: credentialStatus,
                changedById: actorId,
                trainingSessionId: sessionId,
                notes: `Advanced while being added to Training Session #${sessionId}.`,
              },
            });
          }
          await tx.trainingRequestMessage.create({
            data: {
              requestId: linkedRequest.id,
              senderRole: 'SYSTEM',
              body: `Training advanced from ${linkedRequest.status} to ${advancedStatus} when added to the session.`,
            },
          });
        }
        await tx.trainingRequestMessage.create({
          data: {
            requestId: linkedRequest.id,
            senderRole: 'SYSTEM',
            body: trainingSession.startsAt
              ? `Added to Training Session #${sessionId}, scheduled for ${trainingSession.startsAt.toLocaleString('en-GB', {
                  timeZone: 'UTC',
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })} UTC, with attendance status scheduled.`
              : `Added to Training Session #${sessionId}; the date and time are still pending.`,
          },
        });
      }

      const currentAttendee = await tx.trainingSessionAttendee.findUniqueOrThrow({
        where: { id: attendee.id },
        include: {
          user: { select: userSelect },
          trainingRequest: { select: { id: true, status: true } },
        },
      });

      return {
        attendee: currentAttendee,
        linkedRequestId: linkedRequest?.id ?? null,
        trainingName: trainingSession.training.name,
        sessionStatus: trainingSession.status,
        startsAt: trainingSession.startsAt,
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    const scheduleText = result.sessionStatus === 'proposed'
      ? 'Staff will confirm the date and trainer when scheduling is complete.'
      : result.startsAt
        ? `The session starts ${result.startsAt.toLocaleString('en-GB', { timeZone: 'UTC' })} UTC on the Arma3 Training Server.`
        : 'Open your training page for the latest session details.';
    await createTrainingNotification({
      recipientUserIds: [userId],
      title: `Added to ${result.trainingName} training`,
      body: scheduleText,
      actionUrl: result.linkedRequestId
        ? `/trainings/requests/${result.linkedRequestId}`
        : '/profile?tab=trainings',
      createdById: actorId,
    });

    publishUserProfileEvent(userId, { source: 'training-session.attendee-added', sessionId });
    if (result.linkedRequestId) {
      publishTrainingChatEvent(result.linkedRequestId, {
        source: 'session-attendee',
        sessionId,
        attendeeId: result.attendee.id,
        status: result.attendee.status,
      });
    }

    return NextResponse.json({ attendee: result.attendee }, { status: 201 });
  } catch (error) {
    if (error instanceof AttendeeApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        return NextResponse.json({ error: 'User or training request is already linked to a session' }, { status: 409 });
      }
      if (error.code === 'P2034') {
        return NextResponse.json(
          { error: 'The session changed while adding the attendee. Refresh and try again.' },
          { status: 409 },
        );
      }
    }
    console.error('Error adding training session attendee:', error);
    return NextResponse.json({ error: 'Failed to add attendee' }, { status: 500 });
  }
}
