import { validateQueryParameters, parseCursorPagination } from '@/lib/api/validation';
import { writeApiAudit, shouldAuditUserRead } from '@/lib/api/audit';
import { readJsonBody } from '@/lib/api/request';
import { randomBytes } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { handleApiRequest } from '@/lib/api/handler';
import { apiSuccess, apiError } from '@/lib/api/response';
import { botTokenSelect, parseBotTokenBody } from '@/lib/api/bot-tokens';

export async function GET(request: Request) {
  return handleApiRequest(request, 'system:super_admin', async (principal, audit) => {
    const queryError = validateQueryParameters(request, ['limit', 'cursor']);
    if (queryError) return apiError(400, 'invalid_request', queryError);
    const pagination = parseCursorPagination(new URL(request.url).searchParams, { defaultLimit: 50, maxLimit: 100 });
    if (pagination.error !== undefined) return apiError(400, 'invalid_request', pagination.error);
    const { limit, cursor } = pagination.data;
    const rows = await prisma.botToken.findMany({ where: cursor ? { id: { gt: cursor } } : {}, orderBy: { id: 'asc' }, take: limit + 1, select: botTokenSelect });
    const data = rows.slice(0, limit);
    const targetUserIds = [...new Set(data.flatMap(token => token.createdBy ? [token.createdBy.id] : []))];
    if (shouldAuditUserRead(principal, targetUserIds)) await writeApiAudit(prisma, audit, { action: 'user_data.read', resource: 'bot_token_creator', targetUserIds, outcome: 'success' });
    return apiSuccess(data, { meta: { limit, nextCursor: rows.length > limit ? String(data.at(-1)!.id) : null } });
  });
}

export async function POST(request: Request) {
  return handleApiRequest(request, 'system:super_admin', async (principal, context) => {
    const queryError = validateQueryParameters(request, []);
    if (queryError) return apiError(400, 'invalid_request', queryError);
    const parsed = parseBotTokenBody(await readJsonBody(request), true);
    if (parsed.error) return parsed.error;
    const token = await prisma.$transaction(async tx => {
      const created = await tx.botToken.create({
        data: { ...parsed.data, name: parsed.data.name!, token: randomBytes(32).toString('hex'), createdById: principal.kind === 'user' ? principal.userId : null },
        select: { ...botTokenSelect, token: true },
      });
      await writeApiAudit(tx, context, { action: 'bot_token.created', resource: 'bot_token', resourceId: String(created.id), outcome: 'success', after: { name: created.name, isActive: created.isActive } });
      return created;
    });
    return apiSuccess(token, { status: 201 });
  });
}
