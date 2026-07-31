import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { checkPermission } from '@/lib/auth-middleware';
import { isDiscordSnowflake } from '@/lib/bot-api';
import { prisma } from '@/lib/prisma';

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const allowed = (session.user.permissions?.['system:super_admin'] ?? 0) > 0
    || await checkPermission(session.user.id, 'rank:edit');
  if (!allowed) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const guildId = new URL(request.url).searchParams.get('guildId');
  if (!isDiscordSnowflake(guildId)) return NextResponse.json({ error: 'Invalid guildId' }, { status: 400 });
  const mappings = await prisma.rankDiscordRole.findMany({
    where: { guildId }, include: { rank: true }, orderBy: { rank: { orderIndex: 'asc' } },
  });
  return NextResponse.json({ guildId, mappings });
}
