import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';

export async function GET() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const accounts = await prisma.authAccount.findMany({
      where: { userId: session.user.id },
      select: { provider: true },
    });

    const providers = accounts.map(account => account.provider);

    return NextResponse.json({ providers });
  } catch (error) {
    console.error('Error fetching auth providers:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
