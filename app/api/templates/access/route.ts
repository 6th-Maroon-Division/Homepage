import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { checkPermission } from '@/lib/auth-middleware';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const [canCreate, canEdit, canDelete, canCreateOrbat, canEditOrbat, isSuperAdmin] = await Promise.all([
    checkPermission(session.user.id, 'template:create'),
    checkPermission(session.user.id, 'template:edit'),
    checkPermission(session.user.id, 'template:delete'),
    checkPermission(session.user.id, 'orbat:create'),
    checkPermission(session.user.id, 'orbat:edit'),
    checkPermission(session.user.id, 'system:super_admin'),
  ]);

  return NextResponse.json({
    canCreate: isSuperAdmin || canCreate,
    canEdit: isSuperAdmin || canEdit,
    canDelete: isSuperAdmin || canDelete,
    canRead: isSuperAdmin || canCreate || canEdit || canDelete || canCreateOrbat || canEditOrbat,
  });
}
