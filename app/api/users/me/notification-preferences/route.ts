import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import { getOrCreateNotificationPreferences, parseNotificationPatch } from '@/lib/notification-preferences';

async function currentUserId() {
  const session = await getServerSession(authOptions);
  const userId = Number(session?.user?.id);
  return Number.isInteger(userId) && userId > 0 ? userId : null;
}

export async function GET() {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json(await getOrCreateNotificationPreferences(userId));
}

export async function PATCH(request: NextRequest) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Request body must be JSON.' }, { status: 400 }); }
  const parsed = parseNotificationPatch(body);
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 422 });
  return NextResponse.json(await prisma.userNotificationPreference.upsert({
    where: { userId }, update: parsed.data, create: { userId, ...parsed.data },
  }));
}
