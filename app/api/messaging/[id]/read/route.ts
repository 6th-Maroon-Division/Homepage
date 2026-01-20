// app/api/messaging/[id]/read/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { id } = await params;
    const recipientId = parseInt(id);

    if (isNaN(recipientId)) {
      return NextResponse.json({ error: 'Invalid message ID' }, { status: 400 });
    }

    // Verify this message belongs to the current user and mark as read
    const recipient = await prisma.messageRecipient.findFirst({
      where: {
        id: recipientId,
        userId: session.user.id,
      },
    });

    if (!recipient) {
      return NextResponse.json({ error: 'Message not found' }, { status: 404 });
    }

    // Mark as read if not already
    if (!recipient.isRead) {
      await prisma.messageRecipient.update({
        where: { id: recipientId },
        data: {
          isRead: true,
          readAt: new Date(),
        },
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error marking message as read:', error);
    return NextResponse.json(
      { error: 'Failed to update message' },
      { status: 500 }
    );
  }
}
