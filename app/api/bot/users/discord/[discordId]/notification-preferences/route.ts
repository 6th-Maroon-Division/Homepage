import { NextRequest, NextResponse } from 'next/server';
import { authenticateDatabaseBot, botError, resolveDiscordUser } from '@/lib/bot-api';
import { prisma } from '@/lib/prisma';
import { getOrCreateNotificationPreferences, parseNotificationPatch } from '@/lib/notification-preferences';

type Context = { params: Promise<{ discordId: string }> };

async function userFor(request: NextRequest, route: Context) {
  if (!(await authenticateDatabaseBot(request))) return { error: botError(401, 'unauthorized', 'Invalid or revoked bot token.') } as const;
  const { discordId } = await route.params;
  const user = await resolveDiscordUser(decodeURIComponent(discordId).trim());
  if (!user) return { error: botError(404, 'not_found', 'Linked Discord user not found.') } as const;
  return { user } as const;
}

export async function GET(request: NextRequest, route: Context) {
  const result = await userFor(request, route);
  if ('error' in result) return result.error;
  return NextResponse.json(await getOrCreateNotificationPreferences(result.user.id));
}

export async function PATCH(request: NextRequest, route: Context) {
  const result = await userFor(request, route);
  if ('error' in result) return result.error;
  let body: unknown;
  try { body = await request.json(); } catch { return botError(400, 'invalid_request', 'Request body must be JSON.'); }
  const parsed = parseNotificationPatch(body);
  if ('error' in parsed) return botError(422, 'validation_failed', parsed.error);
  const preferences = await prisma.userNotificationPreference.upsert({
    where: { userId: result.user.id },
    update: parsed.data,
    create: { userId: result.user.id, ...parsed.data },
  });
  return NextResponse.json(preferences);
}
