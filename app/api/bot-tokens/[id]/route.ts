import { writeApiAudit, shouldAuditUserRead } from '@/lib/api/audit';
import { readJsonBody } from '@/lib/api/request';
import { prisma } from '@/lib/prisma';
import { handleApiRequest } from '@/lib/api/handler';
import { apiSuccess, apiError } from '@/lib/api/response';
import { parsePositiveId } from '@/lib/api/validation';
import { botTokenSelect, parseBotTokenBody } from '@/lib/api/bot-tokens';

type Context = { params: Promise<{ id: string }> };

async function existingToken(context: Context) {
  const id = parsePositiveId((await context.params).id);
  if (!id) return { error: apiError(400, 'invalid_request', 'Invalid token id.') } as const;
  const token = await prisma.botToken.findUnique({ where: { id }, select: botTokenSelect });
  if (!token) return { error: apiError(404, 'not_found', 'Token not found.') } as const;
  return { token } as const;
}

export async function GET(request: Request, context: Context) {
  return handleApiRequest(request, 'system:super_admin', async (principal, audit) => {
    const result = await existingToken(context);
    if (result.error) return result.error;
    const targetUserIds = result.token.createdBy ? [result.token.createdBy.id] : [];
    if (shouldAuditUserRead(principal, targetUserIds)) await writeApiAudit(prisma, audit, { action: 'user_data.read', resource: 'bot_token_creator', resourceId: String(result.token.id), targetUserIds, outcome: 'success' });
    return apiSuccess(result.token);
  });
}

export async function PATCH(request: Request, context: Context) {
  return handleApiRequest(request, 'system:super_admin', async (_principal, audit) => {
    const id = parsePositiveId((await context.params).id);
    if (!id) return apiError(400, 'invalid_request', 'Invalid token id.');
    const parsed = parseBotTokenBody(await readJsonBody(request), false);
    if (parsed.error) return parsed.error;
    return prisma.$transaction(async tx => {
      const before = await tx.botToken.findUnique({ where: { id }, select: botTokenSelect });
      if (!before) return apiError(404, 'not_found', 'Token not found.');
      const after = await tx.botToken.update({ where: { id }, data: parsed.data, select: botTokenSelect });
      await writeApiAudit(tx, audit, { action: 'bot_token.updated', resource: 'bot_token', resourceId: String(id), outcome: 'success', before: { name: before.name, isActive: before.isActive }, after: { name: after.name, isActive: after.isActive } });
      return apiSuccess(after);
    });
  });
}

export async function DELETE(request: Request, context: Context) {
  return handleApiRequest(request, 'system:super_admin', async (_principal, audit) => {
    const id = parsePositiveId((await context.params).id);
    if (!id) return apiError(400, 'invalid_request', 'Invalid token id.');
    return prisma.$transaction(async tx => {
      const before = await tx.botToken.findUnique({ where: { id }, select: botTokenSelect });
      if (!before) return apiError(404, 'not_found', 'Token not found.');
      await tx.botToken.delete({ where: { id } });
      await writeApiAudit(tx, audit, { action: 'bot_token.deleted', resource: 'bot_token', resourceId: String(id), outcome: 'success', before: { name: before.name, isActive: before.isActive } });
      return apiSuccess(null);
    });
  });
}
