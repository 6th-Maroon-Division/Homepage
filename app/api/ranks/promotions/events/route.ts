import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { checkPermission } from '@/lib/auth-middleware';
import { subscribePromotionEvents } from '@/lib/realtime/promotion-events';

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

  const hasPermission = await checkPermission(session.user.id, 'rank:manage_promotions');
  if (!hasPermission) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
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
      send(formatSseMessage({
        id: `connected-${Date.now()}`,
        type: 'stream.connected',
        occurredAt: new Date().toISOString(),
        payload: null,
      }));

      const unsubscribe = subscribePromotionEvents((event) => {
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
