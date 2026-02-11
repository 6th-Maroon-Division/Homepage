import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from './prisma';
import { PermissionKey } from './permissions';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';

/**
 * Extend NextRequest with user session
 */
declare global {
  namespace Express {
    interface Request {
      session?: Awaited<ReturnType<typeof getServerSession>>;
    }
  }
}

/**
 * Check if user has a permission (simple check, no hierarchy)
 */
export async function checkPermission(userId: number, permission: PermissionKey): Promise<boolean> {
  const userPerm = await prisma.userPermission.findFirst({
    where: {
      userId,
      permission: { key: permission },
    },
  });
  return (userPerm?.value ?? 0) > 0;
}

/**
 * Check if user can perform action on target (hierarchy aware)
 * Returns true if actor's permission value > target's permission value
 */
export async function checkHierarchyPermission(
  actorId: number,
  targetId: number,
  permission: PermissionKey
): Promise<boolean> {
  const [actorPerm, targetPerm] = await Promise.all([
    prisma.userPermission.findFirst({
      where: {
        userId: actorId,
        permission: { key: permission },
      },
    }),
    prisma.userPermission.findFirst({
      where: {
        userId: targetId,
        permission: { key: permission },
      },
    }),
  ]);

  const actorValue = actorPerm?.value ?? 0;
  const targetValue = targetPerm?.value ?? 0;

  // Same user gets automatic access
  if (actorId === targetId) {
    return true;
  }

  // Actor must have higher value than target
  return actorValue > targetValue;
}

/**
 * Middleware to protect API routes requiring a specific permission
 * Checks if user has the permission (simple check)
 *
 * Usage:
 * ```typescript
 * export const POST = withPermission('training:mark', async (req) => {
 *   // Your handler
 * });
 * ```
 */
export function withPermission(permission: PermissionKey) {
  return function middleware(handler: (req: NextRequest) => Promise<NextResponse>) {
    return async (req: NextRequest) => {
      const session = await getServerSession(authOptions);

      if (!session?.user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }

      const hasPermission = await checkPermission(session.user.id, permission);

      if (!hasPermission) {
        return NextResponse.json(
          { error: `Requires permission: ${permission}` },
          { status: 403 }
        );
      }

      return handler(req);
    };
  };
}

/**
 * Middleware to protect API routes requiring hierarchy permission
 * User must have higher permission value than the target user
 *
 * Usage:
 * ```typescript
 * export const PUT = withHierarchyPermission('user:edit', async (req) => {
 *   const { searchParams } = new URL(req.url);
 *   const targetUserId = parseInt(searchParams.get('targetId') || '0');
 *   // Your handler
 * });
 * ```
 */
export function withHierarchyPermission(permission: PermissionKey) {
  return function middleware(
    handler: (req: NextRequest, targetUserId: number) => Promise<NextResponse>
  ) {
    return async (req: NextRequest) => {
      const session = await getServerSession(authOptions);

      if (!session?.user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }

      // Extract target user ID from URL params or query
      const { searchParams, pathname } = new URL(req.url);
      let targetUserId = parseInt(searchParams.get('targetId') || '0');

      // Try to extract from pathname (e.g., /api/users/123)
      if (!targetUserId) {
        const match = pathname.match(/\/(\d+)(?:\/|$)/);
        if (match) {
          targetUserId = parseInt(match[1]);
        }
      }

      if (!targetUserId) {
        return NextResponse.json(
          { error: 'Target user ID required' },
          { status: 400 }
        );
      }

      const canAct = await checkHierarchyPermission(session.user.id, targetUserId, permission);

      if (!canAct) {
        return NextResponse.json(
          { error: `Insufficient permissions to perform this action on this user` },
          { status: 403 }
        );
      }

      return handler(req, targetUserId);
    };
  };
}

/**
 * Simple wrapper for routes that require admin (full admin:system permission)
 */
export function withAdminPermission() {
  return withPermission('admin:system');
}

/**
 * Get server session with permissions pre-loaded
 */
export async function getSessionWithPermissions() {
  const session = await getServerSession(authOptions);
  if (session?.user?.id) {
    const permissions = await prisma.userPermission.findMany({
      where: { userId: session.user.id },
      include: { permission: true },
    });
    const permRecord: Record<string, number> = {};
    for (const p of permissions) {
      permRecord[p.permission.key] = p.value;
    }
    return {
      ...session,
      user: {
        ...session.user,
        permissions: permRecord,
      },
    };
  }
  return session;
}
