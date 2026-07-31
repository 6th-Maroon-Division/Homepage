import { createHash, randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export type BotErrorCode =
  | 'invalid_request'
  | 'unauthorized'
  | 'not_found'
  | 'slot_full'
  | 'signup_closed'
  | 'already_signed_up'
  | 'marked_absent'
  | 'rank_required'
  | 'training_required'
  | 'idempotency_conflict'
  | 'conflict'
  | 'validation_failed'
  | 'internal_error';

export function botError(
  status: number,
  code: BotErrorCode,
  message: string,
  details?: Record<string, unknown>,
) {
  return NextResponse.json(
    { error: { code, message, details: details ?? {}, correlationId: randomUUID() } },
    { status },
  );
}

/** New bot contracts intentionally accept only active tokens stored in BotToken. */
export async function authenticateDatabaseBot(request: Request): Promise<boolean> {
  const header = request.headers.get('authorization');
  if (!header?.startsWith('Bearer ')) return false;
  const token = header.slice(7).trim();
  if (!token) return false;

  const found = await prisma.botToken.findFirst({
    where: { token, isActive: true },
    select: { id: true },
  });
  if (!found) return false;

  await prisma.botToken.update({ where: { id: found.id }, data: { lastUsedAt: new Date() } });
  return true;
}

export async function resolveDiscordUser(discordUserId: string) {
  const account = await prisma.authAccount.findUnique({
    where: {
      provider_providerUserId: { provider: 'discord', providerUserId: discordUserId },
    },
    include: { user: true },
  });
  return account?.user ?? null;
}

export function requestHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function parsePositiveId(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function isDiscordSnowflake(value: unknown): value is string {
  return typeof value === 'string' && /^\d{17,20}$/.test(value);
}
