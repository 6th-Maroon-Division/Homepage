// app/api/ranks/reorder/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';

export async function PUT(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  try {
    const body = await request.json();
    const ranks: Array<{ id: number; orderIndex: number }> = body?.ranks;
    if (!Array.isArray(ranks) || ranks.length === 0) {
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
    }

    await prisma.$transaction(
      ranks.map((r) =>
        prisma.rank.update({
          where: { id: r.id },
          data: { orderIndex: r.orderIndex },
        })
      )
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error reordering ranks:', error);
    return NextResponse.json({ error: 'Failed to reorder ranks' }, { status: 500 });
  }
}
