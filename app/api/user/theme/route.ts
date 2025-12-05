import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';

// POST /api/user/theme - Set user's selected theme
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { themeId } = body;

    // Verify user exists in database
    const userExists = await prisma.user.findUnique({
      where: { id: session.user.id },
    });

    if (!userExists) {
      return NextResponse.json(
        { error: 'User not found. Please log out and log back in.' },
        { status: 404 }
      );
    }

    // Validate themeId
    if (themeId !== null) {
      const theme = await prisma.theme.findUnique({
        where: { id: themeId },
      });

      if (!theme) {
        return NextResponse.json({ error: 'Theme not found' }, { status: 404 });
      }

      // Check if user can access this theme (public or their own custom theme)
      if (!theme.isPublic && theme.createdById !== session.user.id) {
        return NextResponse.json({ error: 'Cannot select this theme' }, { status: 403 });
      }
    }

    // Update user's selected theme
    const user = await prisma.user.update({
      where: { id: session.user.id },
      data: { selectedThemeId: themeId },
      include: {
        selectedTheme: true,
      },
    });

    return NextResponse.json({ theme: user.selectedTheme });
  } catch (error) {
    console.error('Error setting user theme:', error);
    return NextResponse.json({ error: 'Failed to set theme' }, { status: 500 });
  }
}

// GET /api/user/theme - Get user's selected theme
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ theme: null });
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      include: {
        selectedTheme: true,
      },
    });

    return NextResponse.json({ theme: user?.selectedTheme || null });
  } catch (error) {
    console.error('Error fetching user theme:', error);
    return NextResponse.json({ error: 'Failed to fetch theme' }, { status: 500 });
  }
}
