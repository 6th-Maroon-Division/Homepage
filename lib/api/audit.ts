import type { Prisma } from '@/generated/prisma/client';
import type { ApiPrincipal } from './principal';

export type ApiAuditContext = {
  principal: ApiPrincipal | null;
  correlationId: string;
  method: string;
  path: string;
};

export function shouldAuditUserRead(principal: ApiPrincipal, userIds: number[]): boolean {
  return userIds.some(id => principal.kind === 'bot' || id !== principal.userId);
}

const secretField = /token|password|secret|authorization|cookie|credential|email|avatar|message|content|body|reason/i;

/** Defense in depth. Callers must supply explicit snapshots of changed fields,
 * never raw requests or returned personal records. */
export function redactAuditValue(value: unknown): Prisma.InputJsonValue {
  if (Array.isArray(value)) return value.map(item => item === null ? null : redactAuditValue(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, secretField.test(key) ? '[REDACTED]' : item === null ? null : redactAuditValue(item)]));
  }
  if (typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return value;
  return '[REDACTED]';
}

export async function writeApiAudit(
  database: Pick<Prisma.TransactionClient, 'apiAuditLog'>,
  context: ApiAuditContext,
  event: {
    action: string; resource: string; resourceId?: string; targetUserIds?: number[];
    outcome: 'success' | 'denied'; before?: unknown; after?: unknown;
  },
) {
  const { principal } = context;
  return database.apiAuditLog.create({ data: {
    correlationId: context.correlationId,
    actorType: principal?.kind ?? 'anonymous',
    actorUserId: principal?.kind === 'user' ? principal.userId : null,
    actorTokenId: principal?.kind === 'bot' ? principal.tokenId : null,
    action: event.action, resource: event.resource, resourceId: event.resourceId,
    targetUserIds: [...new Set(event.targetUserIds ?? [])],
    method: context.method, path: context.path, outcome: event.outcome,
    ...(event.before !== undefined ? { before: redactAuditValue(event.before) } : {}),
    ...(event.after !== undefined ? { after: redactAuditValue(event.after) } : {}),
  } });
}
