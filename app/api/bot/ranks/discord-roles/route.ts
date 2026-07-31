import { NextRequest, NextResponse } from 'next/server';
import { authenticateDatabaseBot, botError, isDiscordSnowflake } from '@/lib/bot-api';
import { prisma } from '@/lib/prisma';

export async function GET(request: NextRequest) {
  if (!(await authenticateDatabaseBot(request))) return botError(401, 'unauthorized', 'Invalid or revoked bot token.');
  const guildId = new URL(request.url).searchParams.get('guildId');
  if (!isDiscordSnowflake(guildId)) return botError(400, 'invalid_request', 'guildId must be a Discord snowflake.');
  const mappings = await prisma.rankDiscordRole.findMany({
    where: { guildId, isActive: true },
    include: { rank: { select: { id: true, name: true, abbreviation: true, orderIndex: true } } },
    orderBy: { rank: { orderIndex: 'asc' } },
  });
  const version = mappings.length
    ? new Date(Math.max(...mappings.map((item) => item.updatedAt.getTime()))).toISOString()
    : null;
  return NextResponse.json({
    guildId, version, mappings: mappings.map((item) => ({
      rankId: item.rank.id, rankName: item.rank.name,
      rankAbbreviation: item.rank.abbreviation, discordRoleId: item.discordRoleId,
    })),
  });
}
