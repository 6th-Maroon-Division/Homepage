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

    const body = await req.json() as {
      username?: string;
      email?: string;
      avatarUrl?: string | null;
    };
    const { username, email, avatarUrl } = body;

    const updateData: {
      username?: string;
      email?: string;
      avatarUrl?: string | null;
    } = {};

    if (Object.prototype.hasOwnProperty.call(body, 'username')) {
      const normalizedUsername = typeof username === 'string' ? username.trim() : '';

      if (!normalizedUsername) {
        return NextResponse.json({ error: 'Username is required' }, { status: 400 });
      }

      if (normalizedUsername.length > 50) {
        return NextResponse.json({ error: 'Username must be 50 characters or fewer' }, { status: 400 });
      }

      updateData.username = normalizedUsername;
    }

    if (Object.prototype.hasOwnProperty.call(body, 'email')) {
      const normalizedEmail = typeof email === 'string' ? email.trim() : '';
      updateData.email = normalizedEmail || undefined;
    }

    // Reject data URLs - they should use the dedicated upload endpoint
    if (avatarUrl && avatarUrl.startsWith('data:')) {
      return NextResponse.json({ 
        error: 'Data URLs not supported. Please use the dedicated avatar upload endpoint.' 
      }, { status: 400 });
    }

    // Reject data URLs - they should use the dedicated upload endpoint
    if (Object.prototype.hasOwnProperty.call(body, 'avatarUrl')) {
      updateData.avatarUrl = avatarUrl || null;
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
    }

    // Update user in database
    const updatedUser = await prisma.user.update({
      where: { id: session.user.id },
      data: updateData,
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
