// app/api/messaging/inbox/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const typeFilter = searchParams.get('type');
    const unreadOnly = searchParams.get('unread') === 'true';
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');

    // Build where clause using Prisma.MessageRecipientWhereInput
    const where = {
      userId: session.user.id,
      ...(unreadOnly && { isRead: false }),
      ...(typeFilter && {
        message: {
          type: typeFilter as 'orbat' | 'training' | 'rankup' | 'general' | 'alert',
        },
      }),
    };

    // Fetch messages for current user
    const recipients = await prisma.messageRecipient.findMany({
      where,
      include: {
        message: {
          select: {
            id: true,
            title: true,
            body: true,
            type: true,
            actionUrl: true,
            createdAt: true,
            createdBy: {
              select: {
                id: true,
                username: true,
              },
            },
          },
        },
      },
      orderBy: {
        deliveredAt: 'desc',
      },
      take: limit,
      skip: offset,
    });

    // Count unread messages
    const unreadCount = await prisma.messageRecipient.count({
      where: {
        userId: session.user.id,
        isRead: false,
      },
    });

    // Transform data for client
    const messages = recipients.map(recipient => ({
      id: recipient.id,
      messageId: recipient.message.id,
      title: recipient.message.title,
      body: recipient.message.body,
      type: recipient.message.type,
      actionUrl: recipient.message.actionUrl,
      isRead: recipient.isRead,
      readAt: recipient.readAt?.toISOString() || null,
      deliveredAt: recipient.deliveredAt.toISOString(),
      createdAt: recipient.message.createdAt.toISOString(),
      createdBy: recipient.message.createdBy,
    }));

    return NextResponse.json({
      messages,
      unreadCount,
      total: messages.length,
      hasMore: recipients.length === limit,
    });
  } catch (error) {
    console.error('Error fetching inbox:', error);
    return NextResponse.json(
      { error: 'Failed to fetch messages' },
      { status: 500 }
    );
  }
}
