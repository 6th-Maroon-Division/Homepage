import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@/generated/prisma/client';
import { authenticateDatabaseBot, botError, parsePositiveId, requestHash, resolveDiscordUser } from '@/lib/bot-api';
import { prisma } from '@/lib/prisma';
import { runSerializableTransaction } from '@/lib/serializable-transaction';
import { resolveOrbatScheduleWindow } from '@/lib/orbat-schedule';
import { getOrbatTrainingAccess } from '@/lib/training-gating';
import { appendBotEvent } from '@/lib/bot-events';

type Context = { params: Promise<{ signupId: string }> };

async function requestContext(request: NextRequest, route: Context, operation: 'signup.update' | 'signup.delete') {
  if (!(await authenticateDatabaseBot(request))) return { error: botError(401, 'unauthorized', 'Invalid or revoked bot token.') } as const;
  const signupId = parsePositiveId((await route.params).signupId);
  if (!signupId) return { error: botError(400, 'invalid_request', 'Invalid signup id.') } as const;
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return { error: botError(400, 'invalid_request', 'Request body must be JSON.') } as const; }
  const discordUserId = typeof body.discordUserId === 'string' ? body.discordUserId.trim() : '';
  if (!discordUserId) return { error: botError(400, 'invalid_request', 'discordUserId is required.') } as const;
  const idempotencyKey = request.headers.get('idempotency-key')?.trim() || null;
  if (idempotencyKey && idempotencyKey.length > 200) return { error: botError(400, 'invalid_request', 'Idempotency-Key is too long.') } as const;
  const payloadHash = requestHash({ signupId, ...body });
  if (idempotencyKey) {
    const receipt = await prisma.botIdempotencyReceipt.findUnique({ where: { idempotencyKey } });
    if (receipt && receipt.expiresAt > new Date()) {
      if (receipt.operation !== operation || receipt.requestHash !== payloadHash) return { error: botError(409, 'idempotency_conflict', 'Idempotency key was used for a different request.') } as const;
      return { replay: NextResponse.json(receipt.responseBody, { status: receipt.responseStatus }) } as const;
    }
  }
  const user = await resolveDiscordUser(discordUserId);
  if (!user) return { error: botError(404, 'not_found', 'Linked Discord user not found.') } as const;
  const signup = await prisma.signup.findUnique({
    where: { id: signupId },
    include: { slot: { include: { orbat: true } } },
  });
  if (!signup || signup.userId !== user.id) return { error: botError(404, 'not_found', 'Signup not found for this Discord user.') } as const;
  return { signupId, signup, user, body, discordUserId, idempotencyKey, payloadHash, operation } as const;
}

async function saveReceipt(input: { idempotencyKey: string | null; payloadHash: string; operation: string }, responseBody: Record<string, unknown>) {
  if (!input.idempotencyKey) return;
  await prisma.botIdempotencyReceipt.upsert({
    where: { idempotencyKey: input.idempotencyKey }, update: {}, create: {
      idempotencyKey: input.idempotencyKey, operation: input.operation, requestHash: input.payloadHash,
      responseStatus: 200, responseBody: responseBody as Prisma.InputJsonValue, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });
}

export async function PUT(request: NextRequest, route: Context) {
  const resolved = await requestContext(request, route, 'signup.update');
  if ('error' in resolved) return resolved.error;
  if ('replay' in resolved) return resolved.replay;
  const slotId = parsePositiveId(resolved.body.slotId);
  if (!slotId) return botError(400, 'invalid_request', 'slotId must be a positive integer.');
  if (slotId === resolved.signup.slotId) {
    const responseBody = { success: true, signupId: resolved.signupId, slotId, orbatId: resolved.signup.slot.orbatId, unchanged: true };
    await saveReceipt(resolved, responseBody);
    return NextResponse.json(responseBody);
  }

  const cutoff = resolveOrbatScheduleWindow(resolved.signup.slot.orbat).cutoff;
  if (cutoff && cutoff < new Date()) return botError(409, 'signup_closed', 'Signups are closed.');
  const target = await prisma.slot.findUnique({
    where: { id: slotId },
    include: { squadRole: { select: { requiredTrainingIds: true, requiredRankIds: true, name: true } }, squad: { select: { name: true } } },
  });
  if (!target || target.orbatId !== resolved.signup.slot.orbatId) return botError(404, 'not_found', 'Target slot is not part of this ORBAT.');
  const absent = await prisma.orbatAttendanceNote.findUnique({
    where: { orbatId_userId: { orbatId: target.orbatId, userId: resolved.user.id } }, select: { status: true },
  });
  if (absent?.status === 'absent') return botError(409, 'marked_absent', 'User is marked absent.');

  const requiredTrainingIds = resolved.signup.slot.orbat.isSideOp ? [] : (target.squadRole?.requiredTrainingIds ?? []);
  if (requiredTrainingIds.length && !(await getOrbatTrainingAccess(resolved.user.id, requiredTrainingIds)).allowed) {
    return botError(422, 'training_required', 'The required training has not been met.');
  }
  const requiredRankIds = resolved.signup.slot.orbat.isSideOp ? [] : (target.squadRole?.requiredRankIds ?? []);
  if (requiredRankIds.length) {
    const [userRank, requiredRanks] = await Promise.all([
      prisma.userRank.findUnique({ where: { userId: resolved.user.id }, select: { currentRank: { select: { orderIndex: true } } } }),
      prisma.rank.findMany({ where: { id: { in: requiredRankIds } }, select: { orderIndex: true } }),
    ]);
    if (requiredRanks.length !== requiredRankIds.length || requiredRanks.some((rank) => (userRank?.currentRank?.orderIndex ?? -1) < rank.orderIndex)) {
      return botError(422, 'rank_required', 'The required rank has not been met.');
    }
  }

  try {
    const updated = await runSerializableTransaction(async (tx) => {
      const [freshSignup, freshSlot, freshNote] = await Promise.all([
        tx.signup.findUnique({ where: { id: resolved.signupId } }),
        tx.slot.findUnique({ where: { id: slotId }, select: { orbatId: true, maxSignups: true, _count: { select: { signups: true } } } }),
        tx.orbatAttendanceNote.findUnique({ where: { orbatId_userId: { orbatId: target.orbatId, userId: resolved.user.id } }, select: { status: true } }),
      ]);
      if (!freshSignup || freshSignup.userId !== resolved.user.id) throw new Error('SIGNUP_CHANGED');
      if (!freshSlot || freshSlot.orbatId !== target.orbatId) throw new Error('SLOT_CHANGED');
      if (freshNote?.status === 'absent') throw new Error('MARKED_ABSENT');
      if (freshSlot.maxSignups !== null && freshSlot._count.signups >= freshSlot.maxSignups) throw new Error('SLOT_FULL');
      const signup = await tx.signup.update({ where: { id: resolved.signupId }, data: { slotId } });
      const responseBody = { success: true, signupId: signup.id, orbatId: target.orbatId, slotId: signup.slotId, slotName: target.squadRole?.name ?? 'Unknown', squadName: target.squad.name };
      await appendBotEvent({
        type: 'orbat.signup_changed', aggregate: 'orbat', aggregateId: target.orbatId,
        payload: { orbatId: target.orbatId, signupId: signup.id, userId: resolved.user.id, discordUserId: resolved.discordUserId, oldSlotId: resolved.signup.slotId, slotId },
      }, tx);
      if (resolved.idempotencyKey) await tx.botIdempotencyReceipt.upsert({
        where: { idempotencyKey: resolved.idempotencyKey }, update: {}, create: {
          idempotencyKey: resolved.idempotencyKey, operation: resolved.operation, requestHash: resolved.payloadHash,
          responseStatus: 200, responseBody, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      });
      return { signup, responseBody };
    });
    return NextResponse.json(updated.responseBody);
  } catch (error) {
    if (error instanceof Error && error.message === 'SLOT_FULL') return botError(409, 'slot_full', 'The selected slot is full.', { slotId });
    if (error instanceof Error && error.message === 'MARKED_ABSENT') return botError(409, 'marked_absent', 'User is marked absent.');
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') return botError(409, 'conflict', 'Signup state changed; retry the request.');
    return botError(409, 'conflict', 'Signup state changed; refresh and retry.');
  }
}

export async function DELETE(request: NextRequest, route: Context) {
  const resolved = await requestContext(request, route, 'signup.delete');
  if ('error' in resolved) return resolved.error;
  if ('replay' in resolved) return resolved.replay;
  const cutoff = resolveOrbatScheduleWindow(resolved.signup.slot.orbat).cutoff;
  if (cutoff && cutoff < new Date()) return botError(409, 'signup_closed', 'Signups are closed.');
  await prisma.$transaction(async (tx) => {
    await tx.signup.delete({ where: { id: resolved.signupId } });
    const responseBody = { success: true, signupId: resolved.signupId, orbatId: resolved.signup.slot.orbatId, cancelled: true };
    await appendBotEvent({
      type: 'orbat.signup_changed', aggregate: 'orbat', aggregateId: resolved.signup.slot.orbatId,
      payload: { orbatId: resolved.signup.slot.orbatId, signupId: resolved.signupId, userId: resolved.user.id, discordUserId: resolved.discordUserId, oldSlotId: resolved.signup.slotId, slotId: null },
    }, tx);
    if (resolved.idempotencyKey) await tx.botIdempotencyReceipt.upsert({
      where: { idempotencyKey: resolved.idempotencyKey }, update: {}, create: {
        idempotencyKey: resolved.idempotencyKey, operation: resolved.operation, requestHash: resolved.payloadHash,
        responseStatus: 200, responseBody, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });
  });
  const responseBody = { success: true, signupId: resolved.signupId, orbatId: resolved.signup.slot.orbatId, cancelled: true };
  return NextResponse.json(responseBody);
}
