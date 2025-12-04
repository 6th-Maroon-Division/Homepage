import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';

export async function GET() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return NextResponse.json({ id: null }, { status: 200 });
  }

  return NextResponse.json({
    id: Number(session.user.id),
    username: session.user.username,
    email: session.user.email,
    avatarUrl: session.user.avatarUrl,
  });
}
