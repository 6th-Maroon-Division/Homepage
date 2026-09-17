import { createHash } from 'node:crypto';
import { prisma } from '@/lib/prisma';

// Backwards-compatible names for the shared API error contract.
export { apiError as botError } from '@/lib/api/response';
export type { ApiErrorCode as BotErrorCode } from '@/lib/api/response';

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

// Compatibility export; shared with browser-facing API handlers.
export { parsePositiveId } from '@/lib/api/validation';

export function isDiscordSnowflake(value: unknown): value is string {
  return typeof value === 'string' && /^\d{17,20}$/.test(value);
}
