import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import { checkPermission } from '@/lib/auth-middleware';
import { validatePermissionUpdateEntries } from '@/lib/permission-api-logic';

/**
 * GET /api/permissions/templates
 * Returns permission templates for admin onboarding/loading.
 */
export async function GET() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const hasPermission = await checkPermission(session.user.id, 'user:manage_permissions');
  if (!hasPermission) {
    return NextResponse.json({ error: 'Forbidden: Insufficient permissions' }, { status: 403 });
  }

  const templates = await prisma.permissionTemplate.findMany({
    include: {
      items: {
        include: {
          permission: {
            select: {
              key: true,
            },
          },
        },
        orderBy: {
          permission: {
            key: 'asc',
          },
        },
      },
    },
    orderBy: {
      name: 'asc',
    },
  });

  return NextResponse.json({
    templates: templates.map((template) => ({
      id: template.id,
      name: template.name,
      description: template.description,
      createdAt: template.createdAt,
      updatedAt: template.updatedAt,
      permissions: template.items.map((item) => ({
        permissionId: item.permissionId,
        key: item.permission.key,
        value: item.value,
      })),
    })),
  });
}

/**
 * POST /api/permissions/templates
 * Body: { name: string, description?: string, permissions: { permissionId: number, value: number }[], overwrite?: boolean }
 */
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const hasPermission = await checkPermission(session.user.id, 'user:manage_permissions');
  if (!hasPermission) {
    return NextResponse.json({ error: 'Forbidden: Insufficient permissions' }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  const description = typeof body?.description === 'string' ? body.description.trim() : '';
  const permissions = body?.permissions;
  const overwrite = Boolean(body?.overwrite);

  if (!name) {
    return NextResponse.json({ error: 'Template name is required' }, { status: 400 });
  }

  const validation = validatePermissionUpdateEntries(permissions);
  if (!validation.valid) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const normalizedEntries = (permissions as Array<{ permissionId: number; value: number }>)
    .map((entry) => ({
      permissionId: entry.permissionId,
      value: Math.max(0, Math.trunc(entry.value)),
    }))
    .filter((entry) => entry.value > 0);

  if (normalizedEntries.length === 0) {
    return NextResponse.json(
      { error: 'Template must include at least one permission with a value greater than 0' },
      { status: 400 }
    );
  }

  const dedupedEntries = Array.from(
    new Map(normalizedEntries.map((entry) => [entry.permissionId, entry])).values()
  );

  const permissionIds = dedupedEntries.map((entry) => entry.permissionId);
  const existingPermissions = await prisma.permission.findMany({
    where: { id: { in: permissionIds } },
    select: { id: true },
  });
  const existingPermissionIds = new Set(existingPermissions.map((permission) => permission.id));
  const invalidPermissionIds = permissionIds.filter((id) => !existingPermissionIds.has(id));

  if (invalidPermissionIds.length > 0) {
    return NextResponse.json(
      { error: 'Invalid permission ID(s)', invalidPermissionIds },
      { status: 400 }
    );
  }

  const existingTemplate = await prisma.permissionTemplate.findUnique({
    where: { name },
    select: { id: true },
  });

  if (existingTemplate && !overwrite) {
    return NextResponse.json(
      { error: 'Template name already exists', code: 'TEMPLATE_EXISTS' },
      { status: 409 }
    );
  }

  const template = await prisma.$transaction(async (tx) => {
    const savedTemplate = existingTemplate
      ? await tx.permissionTemplate.update({
          where: { id: existingTemplate.id },
          data: {
            description: description || null,
            items: {
              deleteMany: {},
              create: dedupedEntries.map((entry) => ({
                permissionId: entry.permissionId,
                value: entry.value,
              })),
            },
          },
        })
      : await tx.permissionTemplate.create({
          data: {
            name,
            description: description || null,
            items: {
              create: dedupedEntries.map((entry) => ({
                permissionId: entry.permissionId,
                value: entry.value,
              })),
            },
          },
        });

    return savedTemplate;
  });

  return NextResponse.json({
    success: true,
    template: {
      id: template.id,
      name: template.name,
      description: template.description,
      createdAt: template.createdAt,
      updatedAt: template.updatedAt,
    },
  });
}
