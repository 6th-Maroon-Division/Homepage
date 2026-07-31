import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { checkPermission } from '@/lib/auth-middleware';
import { isDiscordSnowflake, parsePositiveId } from '@/lib/bot-api';
import { prisma } from '@/lib/prisma';

type Context = { params: Promise<{ rankId: string }> };

async function authorize(route: Context) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) } as const;
  const allowed = (session.user.permissions?.['system:super_admin'] ?? 0) > 0
    || await checkPermission(session.user.id, 'rank:edit');
  if (!allowed) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) } as const;
  const rankId = parsePositiveId((await route.params).rankId);
  if (!rankId) return { error: NextResponse.json({ error: 'Invalid rankId' }, { status: 400 }) } as const;
  return { rankId } as const;
}

export async function PUT(request: NextRequest, route: Context) {
  const result = await authorize(route);
  if ('error' in result) return result.error;
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Request body must be JSON' }, { status: 400 }); }
  if (!isDiscordSnowflake(body.guildId) || !isDiscordSnowflake(body.discordRoleId)) {
    return NextResponse.json({ error: 'guildId and discordRoleId must be Discord snowflakes' }, { status: 422 });
  }
  const rank = await prisma.rank.findUnique({ where: { id: result.rankId }, select: { id: true } });
  if (!rank) return NextResponse.json({ error: 'Rank not found' }, { status: 404 });
  const mapping = await prisma.rankDiscordRole.upsert({
    where: { rankId_guildId: { rankId: result.rankId, guildId: body.guildId } },
    update: { discordRoleId: body.discordRoleId, isActive: body.isActive !== false },
    create: { rankId: result.rankId, guildId: body.guildId, discordRoleId: body.discordRoleId, isActive: body.isActive !== false },
  });
  return NextResponse.json(mapping);
}

export async function DELETE(request: NextRequest, route: Context) {
  const result = await authorize(route);
  if ('error' in result) return result.error;
  const guildId = new URL(request.url).searchParams.get('guildId');
  if (!isDiscordSnowflake(guildId)) return NextResponse.json({ error: 'Invalid guildId' }, { status: 400 });
  await prisma.rankDiscordRole.deleteMany({ where: { rankId: result.rankId, guildId } });
  return new NextResponse(null, { status: 204 });
}
