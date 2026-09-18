import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import type { PermissionKey } from '@/lib/permissions';
import { resolveApiPrincipal, type ApiPrincipal } from './principal';
import { parsePositiveId } from './validation';
import { parsePermissionGrants, hasApiPermission, hasApiHierarchyPermission } from './permissions';
import { apiError } from './response';

async function sessionUserId() { return (await getServerSession(authOptions))?.user?.id; }
async function findSessionUser(id: number) {
  if (id > 2147483647) return null;
  const user = await prisma.user.findUnique({ where: { id }, select: {
    userPermissions: { select: { value: true, permission: { select: { key: true } } } },
  } });
  if (!user) return null;
  return { permissions: parsePermissionGrants(Object.fromEntries(user.userPermissions.map(entry => [entry.permission.key, entry.value]))) ?? {} };
}
export async function getApiSessionPrincipal(): Promise<Extract<ApiPrincipal, { kind: 'user' }> | null> {
  const userId = parsePositiveId(await sessionUserId());
  if (userId === null) return null;
  const user = await findSessionUser(userId);
  return user ? { kind: 'user', userId, permissions: user.permissions } : null;
}
export async function authenticateApi(request: Request) {
  return resolveApiPrincipal(request, {
    sessionUserId,
    findUser: findSessionUser,
    findBot: async token => {
      const bot = await prisma.botToken.findFirst({ where: { token, isActive: true }, select: { id: true } });
      return bot ? { id: bot.id, permissions: { 'system:super_admin': 255 } } : null;
    },
    touchBot: async id => { await prisma.botToken.update({ where: { id }, data: { lastUsedAt: new Date() } }); },
  });
}

export async function requireApiAccess(request: Request, permission?: PermissionKey) {
  const principal = await authenticateApi(request);
  if (!principal) return { principal: null, error: apiError(401, 'unauthorized', 'Valid user session or bot token required.') } as const;
  if (permission && !hasApiPermission(principal.permissions, permission)) {
    return { principal, error: apiError(403, 'forbidden', `Requires permission: ${permission}`, { permission }) } as const;
  }
  return { principal } as const;
}

export async function canAccessApiUser(principal: NonNullable<Awaited<ReturnType<typeof authenticateApi>>>, userId: number, permission: PermissionKey, database: Pick<typeof prisma, 'userPermission'> = prisma) {
  if (principal.kind === 'user' && principal.userId === userId) return true;
  const target = await database.userPermission.findMany({ where: { userId }, select: { value: true, permission: { select: { key: true } } } });
  const grants = parsePermissionGrants(Object.fromEntries(target.map(entry => [entry.permission.key, entry.value])));
  if (grants === null) return (principal.permissions['system:super_admin'] ?? 0) > 0;
  return hasApiHierarchyPermission(principal.permissions, grants, permission);
}

/** Capture request-owned session expiry once. Event callbacks run in the
 * publisher's async context, so they must never resolve the ambient session. */
export async function createApiPrincipalRevalidator(principal: ApiPrincipal): Promise<() => Promise<ApiPrincipal | null>> {
  if (principal.kind === 'bot') {
    const tokenId = principal.tokenId;
    return async () => {
      const token = await prisma.botToken.findFirst({ where: { id: tokenId, isActive: true }, select: { id: true } });
      return token ? { kind: 'bot', tokenId, permissions: { 'system:super_admin': 255 } } : null;
    };
  }
  const userId = principal.userId;
  const session = await getServerSession(authOptions);
  const expiresAt = session && Number(session.user?.id) === userId ? Date.parse(session.expires) : NaN;
  return async () => {
    if (!Number.isFinite(expiresAt) || Date.now() >= expiresAt) return null;
    const user = await findSessionUser(userId);
    return user ? { kind: 'user', userId, permissions: user.permissions } : null;
  };
}
