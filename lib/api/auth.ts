import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import type { PermissionKey } from '@/lib/permissions';
import { resolveApiPrincipal } from './principal';
import { parsePermissionGrants, hasApiPermission, hasApiHierarchyPermission } from './permissions';
import { apiError } from './response';

export async function authenticateApi(request: Request) {
  return resolveApiPrincipal(request, {
    sessionUserId: async () => (await getServerSession(authOptions))?.user?.id,
    findUser: async id => {
      const user = await prisma.user.findUnique({ where: { id }, select: {
        userPermissions: { select: { value: true, permission: { select: { key: true } } } },
      } });
      if (!user) return null;
      return { permissions: parsePermissionGrants(Object.fromEntries(user.userPermissions.map(entry => [entry.permission.key, entry.value]))) ?? {} };
    },
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

export async function canAccessApiUser(principal: NonNullable<Awaited<ReturnType<typeof authenticateApi>>>, userId: number, permission: PermissionKey) {
  if (principal.kind === 'user' && principal.userId === userId) return true;
  const target = await prisma.userPermission.findMany({ where: { userId }, select: { value: true, permission: { select: { key: true } } } });
  const grants = parsePermissionGrants(Object.fromEntries(target.map(entry => [entry.permission.key, entry.value]))) ?? {};
  return hasApiHierarchyPermission(principal.permissions, grants, permission);
}
