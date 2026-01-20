// app/api/ranks/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';

export async function GET() {
  try {
    const ranks = await prisma.rank.findMany({
      orderBy: { orderIndex: 'asc' },
    });
    return NextResponse.json({ ranks });
  } catch (error) {
    console.error('Error fetching ranks:', error);
    return NextResponse.json({ error: 'Failed to fetch ranks' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  try {
    const body = await request.json();
    const {
      name,
      abbreviation,
      orderIndex,
      attendanceRequiredSinceLastRank,
      autoRankupEnabled,
    } = body;

    if (!name || !abbreviation || typeof orderIndex !== 'number') {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const rank = await prisma.rank.create({
      data: {
        name,
        abbreviation,
        orderIndex,
        attendanceRequiredSinceLastRank: attendanceRequiredSinceLastRank ?? null,
        autoRankupEnabled: !!autoRankupEnabled,
      },
    });
    return NextResponse.json({ rank }, { status: 201 });
  } catch (error) {
    console.error('Error creating rank:', error);
    return NextResponse.json({ error: 'Failed to create rank' }, { status: 500 });
  }
}
