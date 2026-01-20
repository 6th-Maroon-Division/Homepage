// app/api/users/[id]/interview/toggle/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  try {
    const { id } = await params;
    const userId = parseInt(id);
    if (isNaN(userId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

    const existing = await prisma.userRank.findUnique({ where: { userId } });
    if (!existing) {
      await prisma.userRank.create({ data: { userId, interviewDone: true } });
      return NextResponse.json({ interviewDone: true });
    }

    const updated = await prisma.userRank.update({
      where: { userId },
      data: { interviewDone: !existing.interviewDone },
    });
    return NextResponse.json({ interviewDone: updated.interviewDone });
  } catch (error) {
    console.error('Error toggling interview:', error);
    return NextResponse.json({ error: 'Failed to toggle interview' }, { status: 500 });
  }
}
