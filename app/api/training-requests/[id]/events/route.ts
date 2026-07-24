import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import { isTrainingStaff } from '@/lib/training-staff';
import { subscribeTrainingChatEvents } from '@/lib/realtime/training-chat-events';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function formatSseMessage(data: unknown, id?: string) {
  return `${id ? `id: ${id}\n` : ''}data: ${JSON.stringify(data)}\n\n`;
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await context.params;
  const requestId = Number(id);
  if (!Number.isInteger(requestId) || requestId <= 0) {
    return NextResponse.json({ error: 'Invalid training request id' }, { status: 400 });
  }

  const trainingRequest = await prisma.trainingRequest.findUnique({
    where: { id: requestId },
    select: { userId: true },
  });
  if (!trainingRequest) {
    return NextResponse.json({ error: 'Training request not found' }, { status: 404 });
  }

  const viewerId = Number(session.user.id);
  if (trainingRequest.userId !== viewerId && !(await isTrainingStaff(viewerId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const send = (chunk: string) => {
        if (!closed) controller.enqueue(encoder.encode(chunk));
      };

      send('retry: 3000\n\n');
      send(formatSseMessage({
        id: `connected-${Date.now()}`,
        type: 'stream.connected',
        requestId,
        occurredAt: new Date().toISOString(),
      }));

      const unsubscribe = subscribeTrainingChatEvents(requestId, (event) => {
        send(formatSseMessage(event, event.id));
      });
      const heartbeat = setInterval(() => send(`: ping ${Date.now()}\n\n`), 15000);

      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // The client already closed the stream.
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
