import { validateQueryParameters, parsePositiveId } from '@/lib/api/validation';
import { writeApiAudit, shouldAuditUserRead } from '@/lib/api/audit';
import { readJsonBody } from '@/lib/api/request';
import { prisma } from '@/lib/prisma';
import { getNotificationPreferences, parseNotificationPatch, serializeNotificationPreferences } from '@/lib/notification-preferences';
import { handleApiRequest } from '@/lib/api/handler';
import { canAccessApiUser } from '@/lib/api/auth';
import { apiError, apiSuccess } from '@/lib/api/response';
import type { ApiPrincipal } from '@/lib/api/principal';

type Context = { params: Promise<{ id: string }> };

async function targetUser(principal: ApiPrincipal, context: Context) {
  const { id } = await context.params;
  const userId = id === 'me' && principal.kind === 'user' ? principal.userId : parsePositiveId(id);
  if (!userId || userId > 2147483647) return { error: apiError(400, 'invalid_request', 'Use a positive user id; me requires a user session.') } as const;
  if (!await canAccessApiUser(principal, userId, 'user:edit')) return { error: apiError(403, 'forbidden', 'Cannot manage this user’s notification preferences.') } as const;
  if (!await prisma.user.findUnique({ where: { id: userId }, select: { id: true } })) return { error: apiError(404, 'not_found', 'User not found.') } as const;
  return { userId } as const;
}

export async function GET(request: Request, context: Context) {
  return handleApiRequest(request, undefined, async (principal, audit) => {
    const queryError = validateQueryParameters(request, []);
    if (queryError) return apiError(400, 'invalid_request', queryError);
    const target = await targetUser(principal, context);
    if (target.error) return target.error;
    const preferences = await getNotificationPreferences(target.userId);
    if (shouldAuditUserRead(principal, [target.userId])) await writeApiAudit(prisma, audit, { action: 'user_data.read', resource: 'notification_preferences', resourceId: String(target.userId), targetUserIds: [target.userId], outcome: 'success' });
    return apiSuccess(preferences);
  });
}

export async function PATCH(request: Request, context: Context) {
  return handleApiRequest(request, undefined, async (principal, audit) => {
    const queryError = validateQueryParameters(request, []);
    if (queryError) return apiError(400, 'invalid_request', queryError);
    const target = await targetUser(principal, context);
    if (target.error) return target.error;
    const parsed = parseNotificationPatch(await readJsonBody(request));
    if ('error' in parsed) return apiError(422, 'validation_failed', parsed.error);
    return prisma.$transaction(async tx => {
      const before = await tx.userNotificationPreference.findUnique({ where: { userId: target.userId } });
      const after = await tx.userNotificationPreference.upsert({ where: { userId: target.userId }, update: parsed.data, create: { userId: target.userId, ...parsed.data } });
      const previousPreferences = serializeNotificationPreferences(before);
      const previousValues = Object.fromEntries(Object.keys(parsed.data).map(key => [key, previousPreferences[key as keyof typeof previousPreferences]]));
      await writeApiAudit(tx, audit, { action: 'notification_preferences.updated', resource: 'notification_preferences', resourceId: String(target.userId), targetUserIds: [target.userId], outcome: 'success', before: previousValues, after: parsed.data });
      return apiSuccess(serializeNotificationPreferences(after));
    });
  });
}
