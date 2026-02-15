// app/api/users/[id]/permissions/audit/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import { checkPermission } from '@/lib/auth-middleware';

/**
 * GET /api/users/[id]/permissions/audit
 * Get permission change audit logs for a specific user
 * Query params:
 *   - limit: number (default 50, max 200)
 *   - offset: number (default 0)
 *   - action: GRANT | REVOKE | MODIFY
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Check if user has permission to manage permissions
  const hasPermission = await checkPermission(session.user.id, 'user:manage_permissions');
  if (!hasPermission) {
    return NextResponse.json({ error: 'Forbidden: Insufficient permissions' }, { status: 403 });
  }

  const { id } = await params;
  const userId = parseInt(id, 10);

  if (isNaN(userId)) {
    return NextResponse.json({ error: 'Invalid user ID' }, { status: 400 });
  }

  // Parse query parameters
  const searchParams = req.nextUrl.searchParams;
  const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 200);
  const offset = parseInt(searchParams.get('offset') || '0', 10);
  const actionFilter = searchParams.get('action') as 'GRANT' | 'REVOKE' | 'MODIFY' | null;

  // Build where clause
  const where: any = {
    targetUserId: userId,
  };

  if (actionFilter && ['GRANT', 'REVOKE', 'MODIFY'].includes(actionFilter)) {
    where.action = actionFilter;
  }

  // Fetch audit logs
  const [logs, totalCount] = await Promise.all([
    prisma.permissionAuditLog.findMany({
      where,
      include: {
        actor: {
          select: {
            id: true,
            username: true,
            avatarUrl: true,
          },
        },
        permission: {
          select: {
            key: true,
            description: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: limit,
      skip: offset,
    }),
    prisma.permissionAuditLog.count({ where }),
  ]);

  return NextResponse.json({
    logs: logs.map((log) => ({
      id: log.id,
      action: log.action,
      permission: {
        key: log.permission.key,
        description: log.permission.description,
      },
      oldValue: log.oldValue,
      newValue: log.newValue,
      reason: log.reason,
      actor: {
        id: log.actor.id,
        username: log.actor.username,
        avatarUrl: log.actor.avatarUrl,
      },
      createdAt: log.createdAt.toISOString(),
      metadata: log.metadata,
    })),
    pagination: {
      total: totalCount,
      limit,
      offset,
      hasMore: offset + limit < totalCount,
    },
  });
}
