import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { username, email, avatarUrl } = await req.json();

    // Reject data URLs - they should use the dedicated upload endpoint
    if (avatarUrl && avatarUrl.startsWith('data:')) {
      return NextResponse.json({ 
        error: 'Data URLs not supported. Please use the dedicated avatar upload endpoint.' 
      }, { status: 400 });
    }

    // Update user in database
    const updatedUser = await prisma.user.update({
      where: { id: session.user.id },
      data: {
        username: username || undefined,
        email: email || undefined,
        avatarUrl: avatarUrl || null,
      },
    });

    return NextResponse.json({ 
      success: true, 
      user: {
        username: updatedUser.username,
        email: updatedUser.email,
        avatarUrl: updatedUser.avatarUrl,
      }
    });
  } catch (error) {
    console.error('Error updating user:', error);
    return NextResponse.json(
      { error: 'Failed to update user' },
      { status: 500 }
    );
  }
}
