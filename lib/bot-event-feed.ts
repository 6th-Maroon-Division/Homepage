import type { BotEvent } from '@/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import { handleApiRequest } from '@/lib/api/handler';
import { authenticateApi } from '@/lib/api/auth';
import { hasApiPermission, parsePermissionGrants } from '@/lib/api/permissions';
import type { ApiPrincipal } from '@/lib/api/principal';
import { writeApiAudit, type ApiAuditContext } from '@/lib/api/audit';
import { apiError, apiSuccess } from '@/lib/api/response';
import { parsePositiveId } from '@/lib/api/validation';
import { parseUtcTimestamp } from '@/lib/api/utc';

const encoder = new TextEncoder();
const maxEventId = BigInt('9223372036854775807');
function eventId(value: string): bigint | null {
  if (!/^(0|[1-9]\d*)$/.test(value) || value.length > 19) return null;
  const parsed = BigInt(value);
  return parsed <= maxEventId ? parsed : null;
}

/** Only stable integration fields are exposed; arbitrary stored JSON is never returned. */
export function eventDto(event: BotEvent) {
  const raw = event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload) ? event.payload : {};
  const payload: Record<string, string | number | null> = {};
  const numbers = event.aggregate === 'rank' ? ['rankHistoryId', 'userId', 'oldRankId', 'newRankId']
    : event.aggregate === 'orbat' ? ['orbatId', 'signupId', 'userId', 'oldSlotId', 'slotId'] : ['trainingId', 'sessionId'];
  for (const key of numbers) {
    const value = raw[key];
    if (value === null || typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 2147483647) payload[key] = value;
  }
  const strings = event.aggregate === 'rank' ? ['changeType', 'source'] : event.aggregate === 'orbat' ? ['name', 'status'] : ['title', 'websiteUrl'];
  for (const key of strings) if (typeof raw[key] === 'string' || raw[key] === null) payload[key] = raw[key];
  if (event.aggregate === 'rank' && (raw.discordUserId === null || typeof raw.discordUserId === 'string' && /^\d{17,20}$/.test(raw.discordUserId))) payload.discordUserId = raw.discordUserId;
  for (const key of ['version', 'startsAt', 'endsAt']) {
    if (raw[key] === null) payload[key] = null;
    else if (typeof raw[key] === 'string') { const date = parseUtcTimestamp(raw[key]); if (date) payload[key] = date.toISOString(); }
  }
  return { id: event.id.toString(), type: /^[a-z][a-z0-9_.-]{0,99}$/.test(event.type) ? event.type : 'unknown', occurredAt: event.occurredAt.toISOString(), payload };
}

async function auditEvents(events: ReturnType<typeof eventDto>[], principal: ApiPrincipal, context: ApiAuditContext) {
  const ids = [...new Set(events.map(event => event.payload.userId).filter((id): id is number => typeof id === 'number' && (principal.kind === 'bot' || id !== principal.userId)))];
  if (ids.length) await writeApiAudit(prisma, context, { action: 'user_data.read', resource: 'event', targetUserIds: ids, outcome: 'success' });
}
async function stillAuthorized(request: Request, principal: ApiPrincipal) {
  if (principal.kind === 'bot') {
    const current = await authenticateApi(request);
    return current?.kind === 'bot' && current.tokenId === principal.tokenId;
  }
  const user = await prisma.user.findUnique({ where: { id: principal.userId }, select: { userPermissions: { select: { value: true, permission: { select: { key: true } } } } } });
  const grants = user && parsePermissionGrants(Object.fromEntries(user.userPermissions.map(grant => [grant.permission.key, grant.value])));
  return !!grants && hasApiPermission(grants, 'system:super_admin');
}

export async function getEventFeed(request: Request) {
  return handleApiRequest(request, 'system:super_admin', async (principal, context) => {
    const params = new URL(request.url).searchParams;
    for (const key of params.keys()) if (!['aggregate', 'cursor', 'limit'].includes(key) || params.getAll(key).length !== 1) return apiError(400, 'invalid_request', 'Only aggregate, cursor and limit are supported once each.');
    const aggregate = params.get('aggregate');
    if (aggregate !== 'rank' && aggregate !== 'orbat' && aggregate !== 'training') return apiError(400, 'invalid_request', 'aggregate must be rank, orbat or training.');
    const limitValue = params.has('limit') ? parsePositiveId(params.get('limit')) : 50;
    if (limitValue === null) return apiError(400, 'invalid_request', 'limit must be a positive integer.');
    const limit = Math.min(limitValue, 100);
    const resumeHeader = request.headers.get('last-event-id');
    if (resumeHeader !== null && params.has('cursor') && resumeHeader !== params.get('cursor')) return apiError(400, 'invalid_request', 'cursor and Last-Event-ID must agree.');
    let after = eventId(resumeHeader ?? params.get('cursor') ?? '0');
    if (after === null) return apiError(400, 'invalid_request', 'cursor must be a non-negative decimal 64-bit event id.');
    const fetchPage = async () => {
      const rows = await prisma.botEvent.findMany({ where: { aggregate, id: { gt: after! } }, orderBy: { id: 'asc' }, take: limit + 1 });
      const data = rows.slice(0, limit).map(eventDto);
      await auditEvents(data, principal, context);
      return { data, meta: { limit, nextCursor: rows.length > limit ? data.at(-1)!.id : null, resumeCursor: data.at(-1)?.id ?? after!.toString() } };
    };
    // Fetch and audit before committing HTTP headers, so handshake failures remain JSON errors.
    const initial = await fetchPage();
    if (!request.headers.get('accept')?.split(',').some(value => value.trim().split(';')[0] === 'text/event-stream')) return apiSuccess(initial.data, { meta: initial.meta });
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let close: (() => void) | undefined;
    const stop = () => { stopped = true; if (timer) clearTimeout(timer); request.signal.removeEventListener('abort', stop); close?.(); };
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        close = () => { try { controller.close(); } catch { /* Already cancelled. */ } };
        const send = (page: typeof initial) => {
          if (stopped) return;
          for (const event of page.data) {
            after = BigInt(event.id);
            controller.enqueue(encoder.encode(`id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify({ data: event, meta: {} })}\n\n`));
          }
          if (!page.data.length) controller.enqueue(encoder.encode(': keepalive\n\n'));
        };
        const poll = async () => {
          try {
            if (stopped) return;
            if (!await stillAuthorized(request, principal)) { stop(); return; }
            const page = await fetchPage();
            send(page);
            if (!stopped) timer = setTimeout(() => { void poll(); }, 5000);
          } catch { stop(); }
        };
        request.signal.addEventListener('abort', stop, { once: true });
        if (request.signal.aborted) { stop(); return; }
        send(initial);
        timer = setTimeout(() => { void poll(); }, 5000);
      },
      cancel() { stopped = true; if (timer) clearTimeout(timer); request.signal.removeEventListener('abort', stop); },
    });
    return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' } });
  });
}
