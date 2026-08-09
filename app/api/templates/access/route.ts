import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const permissionRows = await prisma.userPermission.findMany({
    where: {
      userId: session.user.id,
      value: { gt: 0 },
      permission: { key: { in: [
        'template:create', 'template:edit', 'template:delete',
        'orbat:create', 'orbat:edit', 'system:super_admin',
      ] } },
    },
    select: { permission: { select: { key: true } } },
  });
  const permissions = new Set(permissionRows.map((entry) => entry.permission.key));
  const isSuperAdmin = permissions.has('system:super_admin');
  const canCreate = permissions.has('template:create');
  const canEdit = permissions.has('template:edit');
  const canDelete = permissions.has('template:delete');
  const canCreateOrbat = permissions.has('orbat:create');
  const canEditOrbat = permissions.has('orbat:edit');

  return NextResponse.json({
    canCreate: isSuperAdmin || canCreate,
    canEdit: isSuperAdmin || canEdit,
    canDelete: isSuperAdmin || canDelete,
    canRead: isSuperAdmin || canCreate || canEdit || canDelete || canCreateOrbat || canEditOrbat,
  });
}
