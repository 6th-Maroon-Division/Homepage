// app/api/users/[id]/permissions/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import { checkPermission } from '@/lib/auth-middleware';
import { canModifyUserPermissions } from '@/lib/user-permission-guards';

/**
 * GET /api/users/[id]/permissions
 * Get all permissions for a specific user with their current values
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

  // Verify target user exists
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, username: true, isAdmin: true },
  });

  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  // Fetch all permissions available
  const allPermissions = await prisma.permission.findMany({
    orderBy: { key: 'asc' },
  });

  // Fetch user's current permission values
  const userPermissions = await prisma.userPermission.findMany({
    where: { userId },
    include: { permission: true },
  });

  // Create a map of user's current values
  const userPermissionMap = new Map<number, number>();
  userPermissions.forEach((up) => {
    userPermissionMap.set(up.permissionId, up.value);
  });

  // Build response with all permissions and user's current values
  const permissions = allPermissions.map((perm) => ({
    id: perm.id,
    key: perm.key,
    description: perm.description,
    defaultValue: perm.defaultValue,
    maxValue: perm.maxValue,
    currentValue: userPermissionMap.get(perm.id) ?? 0,
  }));

  return NextResponse.json({
    user: {
      id: user.id,
      username: user.username,
      isAdmin: user.isAdmin,
    },
    permissions,
  });
}

/**
 * PUT /api/users/[id]/permissions
 * Update user's permissions
 * Body: { permissions: { permissionId: number, value: number }[] }
 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

  // Prevent users from modifying their own permissions (even admins)
  if (!canModifyUserPermissions(session.user.id, userId)) {
    return NextResponse.json({ error: 'Cannot modify your own permissions' }, { status: 400 });
  }

  const body = await req.json();
  const { permissions } = body;

  if (!Array.isArray(permissions)) {
    return NextResponse.json({ error: 'Invalid permissions format' }, { status: 400 });
  }

  // Validate all permission data
  for (const perm of permissions) {
    if (typeof perm.permissionId !== 'number' || typeof perm.value !== 'number') {
      return NextResponse.json({ error: 'Invalid permission data' }, { status: 400 });
    }
    if (perm.value < 0 || perm.value > 255) {
      return NextResponse.json({ error: 'Permission value must be between 0 and 255' }, { status: 400 });
    }
  }

  // Verify target user exists
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });

  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  // Update permissions in a transaction
  await prisma.$transaction(async (tx) => {
    // Fetch current permission values for audit logging
    const currentPermissions = await tx.userPermission.findMany({
      where: { userId },
      select: { permissionId: true, value: true },
    });
    
    const currentPermissionMap = new Map<number, number>();
    currentPermissions.forEach((p) => currentPermissionMap.set(p.permissionId, p.value));

    // Capture request metadata for audit
    const metadata = {
      ipAddress: req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown',
      userAgent: req.headers.get('user-agent') || 'unknown',
    };

    for (const perm of permissions) {
      const oldValue = currentPermissionMap.get(perm.permissionId);
      const newValue = perm.value;

      // Determine action type
      let action: 'GRANT' | 'REVOKE' | 'MODIFY';
      if (oldValue === undefined || oldValue === 0) {
        if (newValue > 0) {
          action = 'GRANT';
        } else {
          // No change (0 -> 0), skip audit log
          continue;
        }
      } else {
        if (newValue === 0) {
          action = 'REVOKE';
        } else if (newValue !== oldValue) {
          action = 'MODIFY';
        } else {
          // No change, skip audit log
          continue;
        }
      }

      // Create audit log entry
      await tx.permissionAuditLog.create({
        data: {
          actorId: session.user.id,
          targetUserId: userId,
          permissionId: perm.permissionId,
          action,
          oldValue: oldValue ?? null,
          newValue: newValue === 0 ? null : newValue,
          metadata,
        },
      });

      // Update the actual permission
      if (perm.value === 0) {
        // Delete the permission record if value is 0 (no permission)
        await tx.userPermission.deleteMany({
          where: {
            userId,
            permissionId: perm.permissionId,
          },
        });
      } else {
        // Upsert permission with the given value
        await tx.userPermission.upsert({
          where: {
            userId_permissionId: {
              userId,
              permissionId: perm.permissionId,
            },
          },
          update: {
            value: perm.value,
          },
          create: {
            userId,
            permissionId: perm.permissionId,
            value: perm.value,
          },
        });
      }
    }
  });

  return NextResponse.json({
    success: true,
    message: 'Permissions updated successfully',
  });
}
