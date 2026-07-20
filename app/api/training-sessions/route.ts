import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import { assertEligibleTrainingStaff, isTrainingStaff } from '@/lib/training-staff';
import { createTrainingNotification } from '@/lib/training-notifications';
import { publishTrainingChatEvent } from '@/lib/realtime/training-chat-events';
import { publishUserProfileEvent } from '@/lib/realtime/user-events';
import { Prisma } from '@/generated/prisma/client';

const userSelect = { id: true, username: true, avatarUrl: true } as const;

type JsonObject = Record<string, unknown>;

class SessionConflictError extends Error {}

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

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const viewerId = Number(session.user.id);
  const staffViewer = await isTrainingStaff(viewerId);
  const { searchParams } = new URL(request.url);
  const rawTrainingId = searchParams.get('trainingId');
  const rawTrainerId = searchParams.get('trainerId');
  const trainingId = rawTrainingId === null ? null : parsePositiveInteger(rawTrainingId);
  const trainerId = rawTrainerId === null ? null : parsePositiveInteger(rawTrainerId);
  const status = searchParams.get('status');
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  if (rawTrainingId !== null && trainingId === null) {
    return NextResponse.json({ error: 'Invalid trainingId filter' }, { status: 400 });
  }
  if (rawTrainerId !== null && trainerId === null) {
    return NextResponse.json({ error: 'Invalid trainerId filter' }, { status: 400 });
  }
  if (status && !['proposed', 'scheduled', 'in_progress', 'completed', 'cancelled'].includes(status)) {
    return NextResponse.json({ error: 'Invalid status filter' }, { status: 400 });
  }
  if (!staffViewer && status && ['proposed', 'cancelled'].includes(status)) {
    return NextResponse.json({ sessions: [], isStaff: false });
  }
  const fromDate = from ? new Date(from) : null;
  const toDate = to ? new Date(to) : null;
  if ((fromDate && Number.isNaN(fromDate.getTime())) || (toDate && Number.isNaN(toDate.getTime()))) {
    return NextResponse.json({ error: 'Invalid date filter' }, { status: 400 });
  }
  if (fromDate && toDate && fromDate > toDate) {
    return NextResponse.json({ error: 'from must be before to' }, { status: 400 });
  }

  const sessions = await prisma.trainingSession.findMany({
    where: {
      ...(!staffViewer
        ? {
            attendees: { some: { userId: viewerId, status: { not: 'cancelled' } } },
            status: { notIn: ['proposed', 'cancelled'] },
          }
        : {}),
      ...(trainingId !== null ? { trainingId } : {}),
      ...(trainerId !== null ? { trainerId } : {}),
      ...(status && ['proposed', 'scheduled', 'in_progress', 'completed', 'cancelled'].includes(status)
        ? { status: status as 'proposed' | 'scheduled' | 'in_progress' | 'completed' | 'cancelled' }
        : {}),
      ...(fromDate || toDate
        ? {
            startsAt: {
              ...(fromDate ? { gte: fromDate } : {}),
              ...(toDate ? { lte: toDate } : {}),
            },
          }
        : {}),
    },
    include: {
      training: true,
      trainer: { select: userSelect },
      attendees: {
        ...(!staffViewer ? { where: { userId: viewerId, status: { not: 'cancelled' } } } : {}),
        include: {
          user: { select: userSelect },
          trainingRequest: { select: { id: true } },
        },
      },
    },
    orderBy: [{ startsAt: 'asc' }, { createdAt: 'asc' }],
  });

  return NextResponse.json({
    sessions: sessions.map((item) => ({ ...item, server: 'Arma3 Training Server' })),
    isStaff: staffViewer,
  });
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const actorId = Number(session.user.id);
  if (!(await isTrainingStaff(actorId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
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
  const trainingId = parsePositiveInteger(body.trainingId);
  const trainerId = parsePositiveInteger(body.trainerId);
  if (!trainingId) {
    return NextResponse.json({ error: 'trainingId is required' }, { status: 400 });
  }
  if (!trainerId || !(await assertEligibleTrainingStaff(trainerId))) {
    return NextResponse.json({ error: 'Select an eligible trainer' }, { status: 400 });
  }

  if (body.attendeeUserIds !== undefined && !Array.isArray(body.attendeeUserIds)) {
    return NextResponse.json({ error: 'attendeeUserIds must be an array' }, { status: 400 });
  }
  const rawAttendeeUserIds = Array.isArray(body.attendeeUserIds) ? body.attendeeUserIds : [];
  const parsedAttendeeIds = rawAttendeeUserIds.map(parsePositiveInteger);
  if (parsedAttendeeIds.some((id) => id === null)) {
    return NextResponse.json({ error: 'Every attendee id must be a positive integer' }, { status: 400 });
  }
  const attendeeUserIds = Array.from(new Set(parsedAttendeeIds as number[]));

  if (body.confirmed !== undefined && typeof body.confirmed !== 'boolean') {
    return NextResponse.json({ error: 'confirmed must be a boolean' }, { status: 400 });
  }
  if (body.status !== undefined && body.status !== 'proposed' && body.status !== 'scheduled') {
    return NextResponse.json({ error: 'status must be proposed or scheduled' }, { status: 400 });
  }
  if (body.startsAt !== undefined && body.startsAt !== null && typeof body.startsAt !== 'string') {
    return NextResponse.json({ error: 'startsAt must be an ISO date string or null' }, { status: 400 });
  }
  const startsAt = typeof body.startsAt === 'string' && body.startsAt.trim()
    ? new Date(body.startsAt)
    : null;
  const confirmed = body.confirmed === true || body.status === 'scheduled';
  if (typeof body.startsAt === 'string' && (!body.startsAt.trim() || Number.isNaN(startsAt?.getTime()))) {
    return NextResponse.json({ error: 'Invalid startsAt value' }, { status: 400 });
  }
  if (confirmed && !startsAt) {
    return NextResponse.json({ error: 'startsAt is required for a scheduled session' }, { status: 400 });
  }

  const training = await prisma.training.findUnique({ where: { id: trainingId } });
  if (!training) {
    return NextResponse.json({ error: 'Training not found' }, { status: 404 });
  }
  if (!training.isActive) {
    return NextResponse.json({ error: 'Inactive trainings cannot have new sessions' }, { status: 409 });
  }
  if (!training.requiresTrainingSession) {
    return NextResponse.json({ error: 'This training does not require a scheduled session' }, { status: 409 });
  }

  if (attendeeUserIds.length) {
    const existingUsers = await prisma.user.findMany({
      where: { id: { in: attendeeUserIds } },
      select: { id: true },
    });
    const existingIds = new Set(existingUsers.map((user) => user.id));
    const missingIds = attendeeUserIds.filter((userId) => !existingIds.has(userId));
    if (missingIds.length) {
      return NextResponse.json(
        { error: `Unknown attendee user id${missingIds.length === 1 ? '' : 's'}: ${missingIds.join(', ')}` },
        { status: 400 },
      );
    }
  }

  const hasExplicitDuration = body.durationMinutes !== undefined
    && body.durationMinutes !== null
    && body.durationMinutes !== '';
  const parsedDuration = hasExplicitDuration ? parsePositiveInteger(body.durationMinutes) : null;
  if (hasExplicitDuration && (parsedDuration === null || parsedDuration > 1440)) {
    return NextResponse.json({ error: 'Duration must be between 1 and 1440 minutes' }, { status: 400 });
  }
  const durationMinutes = hasExplicitDuration ? parsedDuration : training.duration;

  if (
    body.specialInstructions !== undefined
    && body.specialInstructions !== null
    && typeof body.specialInstructions !== 'string'
  ) {
    return NextResponse.json({ error: 'specialInstructions must be a string or null' }, { status: 400 });
  }

  let created;
  try {
    created = await prisma.$transaction(async (tx) => {
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
              sessionAttendee: { select: { sessionId: true } },
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
      for (const trainingRequest of activeRequestByUserId.values()) {
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
              trainingRequest: { select: { id: true } },
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
      return { trainingSession, linkedRequestIds };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof SessionConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return NextResponse.json(
        { error: 'One or more attendees were linked to another training session at the same time' },
        { status: 409 },
      );
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
      return NextResponse.json(
        { error: 'The session or attendee list changed concurrently. Refresh and try again.' },
        { status: 409 },
      );
    }
    throw error;
  }

  if (confirmed && startsAt && attendeeUserIds.length) {
    await createTrainingNotification({
      recipientUserIds: attendeeUserIds,
      title: `${training.name} training scheduled`,
      body: `Your training is scheduled for ${startsAt.toLocaleString('en-GB', { timeZone: 'UTC' })} UTC on the Arma3 Training Server.`,
      actionUrl: '/profile?tab=trainings',
      createdById: actorId,
    });
  }
  for (const userId of attendeeUserIds) {
    publishUserProfileEvent(userId, {
      source: 'training-session.created',
      sessionId: created.trainingSession.id,
    });
  }
  for (const requestId of created.linkedRequestIds) {
    publishTrainingChatEvent(requestId, {
      source: 'schedule',
      sessionId: created.trainingSession.id,
      confirmed,
    });
  }

  return NextResponse.json(
    { ...created.trainingSession, server: 'Arma3 Training Server' },
    { status: 201 },
  );
}
