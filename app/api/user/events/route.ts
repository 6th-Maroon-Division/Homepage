import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import { subscribeUserProfileEvents } from '@/lib/realtime/user-events';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function formatSseMessage(data: unknown, id?: string) {
  const message: string[] = [];

  if (id) {
    message.push(`id: ${id}`);
  }

  message.push(`data: ${JSON.stringify(data)}`);

  return `${message.join('\n')}\n\n`;
}

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = Number(session.user.id);
  if (Number.isNaN(userId)) {
    return NextResponse.json({ error: 'Invalid user ID' }, { status: 400 });
  }

  const existingUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });

  if (!existingUser) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let isClosed = false;

      const send = (chunk: string) => {
        if (isClosed) {
          return;
        }
        controller.enqueue(encoder.encode(chunk));
      };

      send('retry: 3000\n\n');
      send(
        formatSseMessage({
          id: `connected-${Date.now()}`,
          type: 'stream.connected',
          occurredAt: new Date().toISOString(),
          payload: null,
        })
      );

      const unsubscribe = subscribeUserProfileEvents(userId, (event) => {
        send(formatSseMessage(event, event.id));
      });

      const heartbeat = setInterval(() => {
        send(`: ping ${Date.now()}\n\n`);
      }, 15000);

      const close = () => {
        if (isClosed) {
          return;
        }

        isClosed = true;
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // no-op
        }
      };

      request.signal.addEventListener('abort', close);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
