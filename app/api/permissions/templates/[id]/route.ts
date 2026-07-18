import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import { checkPermission } from '@/lib/auth-middleware';
import { validatePermissionUpdateEntries } from '@/lib/permission-api-logic';

function parseTemplateId(value: string): number | null {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    return null;
  }
  return id;
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const hasPermission = await checkPermission(session.user.id, 'user:manage_permissions');
  if (!hasPermission) {
    return NextResponse.json({ error: 'Forbidden: Insufficient permissions' }, { status: 403 });
  }

  const { id } = await params;
  const templateId = parseTemplateId(id);
  if (!templateId) {
    return NextResponse.json({ error: 'Invalid template ID' }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  const description = typeof body?.description === 'string' ? body.description.trim() : '';
  const permissions = body?.permissions;

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
  const invalidPermissionIds = permissionIds.filter((permId) => !existingPermissionIds.has(permId));

  if (invalidPermissionIds.length > 0) {
    return NextResponse.json({ error: 'Invalid permission ID(s)', invalidPermissionIds }, { status: 400 });
  }

  const existingTemplate = await prisma.permissionTemplate.findUnique({
    where: { id: templateId },
    select: { id: true },
  });

  if (!existingTemplate) {
    return NextResponse.json({ error: 'Template not found' }, { status: 404 });
  }

  const duplicateName = await prisma.permissionTemplate.findFirst({
    where: {
      name,
      id: { not: templateId },
    },
    select: { id: true },
  });

  if (duplicateName) {
    return NextResponse.json({ error: 'Template name already exists', code: 'TEMPLATE_EXISTS' }, { status: 409 });
  }

  const updatedTemplate = await prisma.permissionTemplate.update({
    where: { id: templateId },
    data: {
      name,
      description: description || null,
      items: {
        deleteMany: {},
        create: dedupedEntries.map((entry) => ({
          permissionId: entry.permissionId,
          value: entry.value,
        })),
      },
    },
  });

  return NextResponse.json({
    success: true,
    template: {
      id: updatedTemplate.id,
      name: updatedTemplate.name,
      description: updatedTemplate.description,
      createdAt: updatedTemplate.createdAt,
      updatedAt: updatedTemplate.updatedAt,
    },
  });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const hasPermission = await checkPermission(session.user.id, 'user:manage_permissions');
  if (!hasPermission) {
    return NextResponse.json({ error: 'Forbidden: Insufficient permissions' }, { status: 403 });
  }

  const { id } = await params;
  const templateId = parseTemplateId(id);
  if (!templateId) {
    return NextResponse.json({ error: 'Invalid template ID' }, { status: 400 });
  }

  const existingTemplate = await prisma.permissionTemplate.findUnique({
    where: { id: templateId },
    select: { id: true, name: true },
  });

  if (!existingTemplate) {
    return NextResponse.json({ error: 'Template not found' }, { status: 404 });
  }

  await prisma.permissionTemplate.delete({ where: { id: templateId } });

  return NextResponse.json({
    success: true,
    message: `Deleted template ${existingTemplate.name}`,
  });
}
