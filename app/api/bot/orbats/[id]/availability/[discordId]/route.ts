import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  authenticateDatabaseBot,
  botError,
  parsePositiveId,
  resolveDiscordUser,
} from '@/lib/bot-api';
import { resolveOrbatScheduleWindow } from '@/lib/orbat-schedule';
import { appendBotEvent } from '@/lib/bot-events';

type Context = { params: Promise<{ id: string; discordId: string }> };
type NoteStatus = 'absent' | 'unsure' | 'late_unsure';

function validStatus(value: unknown): value is NoteStatus {
  return value === 'absent' || value === 'unsure' || value === 'late_unsure';
}

function minutes(value: unknown): number | null | undefined {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function reason(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 500) : null;
}

async function context(request: NextRequest, route: Context) {
  if (!(await authenticateDatabaseBot(request))) {
    return { error: botError(401, 'unauthorized', 'Invalid or revoked bot token.') } as const;
  }
  const params = await route.params;
  const orbatId = parsePositiveId(params.id);
  if (!orbatId) return { error: botError(400, 'invalid_request', 'Invalid ORBAT id.') } as const;
  const discordId = decodeURIComponent(params.discordId).trim();
  const [orbat, user] = await Promise.all([
    prisma.orbat.findUnique({
      where: { id: orbatId },
      select: { id: true, startsAtUtc: true, endsAtUtc: true, eventDate: true, startTime: true, endTime: true },
    }),
    resolveDiscordUser(discordId),
  ]);
  if (!orbat) return { error: botError(404, 'not_found', 'ORBAT not found.', { orbatId }) } as const;
  if (!user) return { error: botError(404, 'not_found', 'Linked Discord user not found.', { discordId }) } as const;
  return { orbat, user } as const;
}

async function state(orbatId: number, userId: number) {
  const [note, signup] = await Promise.all([
    prisma.orbatAttendanceNote.findUnique({ where: { orbatId_userId: { orbatId, userId } } }),
    prisma.signup.findFirst({
      where: { userId, slot: { orbatId } },
      select: { id: true, slotId: true },
    }),
  ]);
  return { orbatId, userId, signup, note };
}

export async function GET(request: NextRequest, route: Context) {
  const resolved = await context(request, route);
  if ('error' in resolved) return resolved.error!;
  return NextResponse.json(await state(resolved.orbat.id, resolved.user.id));
}

export async function PUT(request: NextRequest, route: Context) {
  const resolved = await context(request, route);
  if ('error' in resolved) return resolved.error!;
  const cutoff = resolveOrbatScheduleWindow(resolved.orbat).cutoff;
  if (cutoff && cutoff < new Date()) {
    return botError(409, 'signup_closed', 'Operation is in the past. Attendance notes are closed.');
  }

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return botError(400, 'invalid_request', 'Request body must be JSON.'); }
  if (!validStatus(body.status)) {
    return botError(422, 'validation_failed', 'Status must be absent, unsure, or late_unsure.');
  }
  const lateMinutes = minutes(body.lateMinutes);
  const leaveEarlyMinutes = minutes(body.leaveEarlyMinutes);
  if (lateMinutes === undefined || leaveEarlyMinutes === undefined) {
    return botError(422, 'validation_failed', 'Minute estimates must be non-negative integers.');
  }
  if (body.status === 'late_unsure' && lateMinutes === null && leaveEarlyMinutes === null) {
    return botError(422, 'validation_failed', 'Provide how late or how early the user may be.');
  }

  const note = await prisma.$transaction(async (tx) => {
    const saved = await tx.orbatAttendanceNote.upsert({
      where: { orbatId_userId: { orbatId: resolved.orbat.id, userId: resolved.user.id } },
      update: {
        status: body.status as NoteStatus,
        reason: reason(body.reason),
        lateMinutes: body.status === 'late_unsure' ? lateMinutes : null,
        leaveEarlyMinutes: body.status === 'late_unsure' ? leaveEarlyMinutes : null,
      },
      create: {
        orbatId: resolved.orbat.id,
        userId: resolved.user.id,
        status: body.status as NoteStatus,
        reason: reason(body.reason),
        lateMinutes: body.status === 'late_unsure' ? lateMinutes : null,
        leaveEarlyMinutes: body.status === 'late_unsure' ? leaveEarlyMinutes : null,
      },
    });
    await appendBotEvent({
      type: 'orbat.availability_changed', aggregate: 'orbat', aggregateId: resolved.orbat.id,
      payload: { orbatId: resolved.orbat.id, userId: resolved.user.id, discordUserId: decodeURIComponent((await route.params).discordId), status: saved.status },
    }, tx);
    return saved;
  });
  const current = await state(resolved.orbat.id, resolved.user.id);
  return NextResponse.json({ ...current, note });
}

export async function DELETE(request: NextRequest, route: Context) {
  const resolved = await context(request, route);
  if ('error' in resolved) return resolved.error!;
  const cutoff = resolveOrbatScheduleWindow(resolved.orbat).cutoff;
  if (cutoff && cutoff < new Date()) {
    return botError(409, 'signup_closed', 'Operation is in the past. Attendance notes are closed.');
  }
  await prisma.$transaction(async (tx) => {
    await tx.orbatAttendanceNote.deleteMany({ where: { orbatId: resolved.orbat.id, userId: resolved.user.id } });
    await appendBotEvent({
      type: 'orbat.availability_changed', aggregate: 'orbat', aggregateId: resolved.orbat.id,
      payload: { orbatId: resolved.orbat.id, userId: resolved.user.id, status: null },
    }, tx);
  });
  return NextResponse.json(await state(resolved.orbat.id, resolved.user.id));
}
