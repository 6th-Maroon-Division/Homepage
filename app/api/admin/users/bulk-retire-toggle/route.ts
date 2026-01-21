import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { userIds } = await request.json();
  if (!Array.isArray(userIds) || userIds.length === 0) {
    return NextResponse.json({ error: 'userIds (non-empty array) required' }, { status: 400 });
  }

  // Get current states
  const current = await prisma.userRank.findMany({
    where: { userId: { in: userIds } },
    select: { userId: true, retired: true },
  });

  const updates = await prisma.$transaction(
    current.map((ur) =>
      prisma.userRank.update({
        where: { userId: ur.userId },
        data: { retired: !ur.retired },
      })
    )
  );

  return NextResponse.json({ success: true, updatedCount: updates.length });
}
