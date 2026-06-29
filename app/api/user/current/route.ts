import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';

export async function GET() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return NextResponse.json({ id: null }, { status: 200 });
  }

  // Fetch avatar URL from database (not stored in session to avoid JWT size issues)
  const user = await prisma.user.findUnique({
    where: { id: Number(session.user.id) },
    select: { avatarUrl: true }
  });

  return NextResponse.json({
    id: Number(session.user.id),
    username: session.user.username,
    email: session.user.email,
    avatarUrl: user?.avatarUrl ?? null,
  });
}
