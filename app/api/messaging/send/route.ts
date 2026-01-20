// app/api/messaging/send/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { title, message: messageBody, type, actionUrl, audience } = body;

    if (!title || !messageBody || !audience) {
      return NextResponse.json(
        { error: 'Missing required fields: title, message, audience' },
        { status: 400 }
      );
    }

    // Validate message type
    type MessageType = 'orbat' | 'training' | 'rankup' | 'general' | 'alert';
    type AudienceType = 'user' | 'rank' | 'all' | 'admin';
    
    const validTypes: MessageType[] = ['orbat', 'training', 'rankup', 'general', 'alert'];
    const messageType = (type as MessageType) || 'general';
    if (!validTypes.includes(messageType)) {
      return NextResponse.json({ error: 'Invalid message type' }, { status: 400 });
    }

    // Parse audience and determine recipients
    let recipientUserIds: number[] = [];
    let audienceType: AudienceType = 'user';
    const audienceValue: string | null = null;

    if (audience === 'all') {
      // Broadcast to all users
      const users = await prisma.user.findMany({ select: { id: true } });
      recipientUserIds = users.map(u => u.id);
      audienceType = 'all';
    } else if (audience === 'admin') {
      // Admin-only alerts (requires admin permission)
      if (!session.user?.isAdmin) {
        return NextResponse.json({ error: 'Admin permission required' }, { status: 403 });
      }
      const admins = await prisma.user.findMany({
        where: { isAdmin: true },
        select: { id: true },
      });
      recipientUserIds = admins.map(u => u.id);
      audienceType = 'admin';
    } else if (Array.isArray(audience.userIds)) {
      // Specific user IDs
      recipientUserIds = audience.userIds;
      audienceType = 'user';
    } else if (Array.isArray(audience.rankIds)) {
      // Future: Fetch users with these ranks when rank system is implemented
      // For now, return error
      return NextResponse.json(
        { error: 'Rank-based targeting not yet implemented' },
        { status: 400 }
      );
    } else {
      return NextResponse.json(
        { error: 'Invalid audience format. Use "all", "admin", or {userIds: [...]}' },
        { status: 400 }
      );
    }

    if (recipientUserIds.length === 0) {
      return NextResponse.json(
        { error: 'No recipients found for this audience' },
        { status: 400 }
      );
    }

    // Create message and recipients in a transaction
    const result = await prisma.$transaction(async (tx) => {
      // Create the message
      const createdMessage = await tx.message.create({
        data: {
          title,
          body: messageBody,
          type: messageType,
          actionUrl: actionUrl || null,
          createdById: session.user?.id || null,
        },
      });

      // Create recipient records for each user
      const recipientRecords = recipientUserIds.map(userId => ({
        messageId: createdMessage.id,
        userId,
        audienceType,
        audienceValue,
        isRead: false,
        channel: 'web' as const,
      }));

      await tx.messageRecipient.createMany({
        data: recipientRecords,
      });

      return createdMessage;
    });

    return NextResponse.json(
      {
        success: true,
        message: result,
        recipientCount: recipientUserIds.length,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Error sending message:', error);
    return NextResponse.json(
      { error: 'Failed to send message' },
      { status: 500 }
    );
  }
}
