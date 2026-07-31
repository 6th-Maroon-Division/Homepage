import { NextRequest, NextResponse } from 'next/server';
import { botError } from '@/lib/bot-api';
import { prisma } from '@/lib/prisma';
import { serializeBotEvent } from '@/lib/bot-events';

const encoder = new TextEncoder();

export async function botEventFeed(request: NextRequest, aggregate: 'rank' | 'orbat' | 'training') {
  const raw = request.headers.get('last-event-id') ?? new URL(request.url).searchParams.get('cursor') ?? '0';
  let after: bigint;
  try { after = BigInt(raw); } catch { return botError(400, 'invalid_request', 'Cursor must be a non-negative event id.'); }
  if (after < BigInt(0)) return botError(400, 'invalid_request', 'Cursor must be a non-negative event id.');
  const fetchEvents = () => prisma.botEvent.findMany({ where: { aggregate, id: { gt: after } }, orderBy: { id: 'asc' }, take: 100 });
  if (!request.headers.get('accept')?.includes('text/event-stream')) {
    const events = await fetchEvents();
    return NextResponse.json({ events: events.map(serializeBotEvent), nextCursor: events.at(-1)?.id.toString() ?? after.toString() });
  }
  let stopped = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = async () => {
        const events = await fetchEvents();
        for (const event of events) {
          after = event.id;
          controller.enqueue(encoder.encode(`id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(serializeBotEvent(event))}\n\n`));
        }
        if (!events.length) controller.enqueue(encoder.encode(': keepalive\n\n'));
      };
      await send();
      timer = setInterval(() => { if (!stopped) void send().catch(() => {
        stopped = true;
        if (timer) clearInterval(timer);
        try { controller.close(); } catch {}
      }); }, 5_000);
      request.signal.addEventListener('abort', () => { stopped = true; if (timer) clearInterval(timer); try { controller.close(); } catch {} }, { once: true });
    },
    cancel() { stopped = true; if (timer) clearInterval(timer); },
  });
  return new NextResponse(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' } });
}
