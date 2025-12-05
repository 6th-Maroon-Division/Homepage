import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';

// PATCH /api/themes/admin/[id] - Update a theme (admin only)
export async function PATCH(
  request: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  const params = await props.params;
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.isAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const themeId = parseInt(params.id);
    const body = await request.json();

    const theme = await prisma.theme.update({
      where: { id: themeId },
      data: body,
    });

    return NextResponse.json(theme);
  } catch (error) {
    console.error('Error updating theme:', error);
    return NextResponse.json({ error: 'Failed to update theme' }, { status: 500 });
  }
}

// DELETE /api/themes/admin/[id] - Delete a theme (admin only)
export async function DELETE(
  request: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  const params = await props.params;
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.isAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const themeId = parseInt(params.id);

    // Check if it's a default theme
    const theme = await prisma.theme.findUnique({
      where: { id: themeId },
    });

    if (theme?.isDefaultLight || theme?.isDefaultDark) {
      return NextResponse.json(
        { error: 'Cannot delete a default theme' },
        { status: 400 }
      );
    }

    await prisma.theme.delete({
      where: { id: themeId },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting theme:', error);
    return NextResponse.json({ error: 'Failed to delete theme' }, { status: 500 });
  }
}
