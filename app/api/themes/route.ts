import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';

// GET /api/themes - Get all public themes and user's custom theme if logged in
export async function GET() {
  try {
    const session = await getServerSession(authOptions);

    // Get all public themes
    const publicThemes = await prisma.theme.findMany({
      where: { 
        isPublic: true,
        isEnabled: true
      },
      select: {
        id: true,
        name: true,
        isDefaultLight: true,
        isDefaultDark: true,
        background: true,
        foreground: true,
        primary: true,
        primaryForeground: true,
        secondary: true,
        secondaryForeground: true,
        accent: true,
        accentForeground: true,
        muted: true,
        mutedForeground: true,
        border: true,
        customCss: true,
      },
      orderBy: [{ name: 'asc' }],
    });

    let customTheme = null;
    if (session?.user?.id) {
      customTheme = await prisma.theme.findFirst({
        where: {
          createdById: session.user.id,
        },
        select: {
          id: true,
          name: true,
          isPublic: false,
          background: true,
          foreground: true,
          primary: true,
          primaryForeground: true,
          secondary: true,
          secondaryForeground: true,
          accent: true,
          accentForeground: true,
          muted: true,
          mutedForeground: true,
          border: true,
          customCss: true,
        },
      });
    }

    return NextResponse.json({
      publicThemes,
      customTheme,
    });
  } catch (error) {
    console.error('Error fetching themes:', error);
    return NextResponse.json({ error: 'Failed to fetch themes' }, { status: 500 });
  }
}

// POST /api/themes - Create or update user's custom theme (one per user)
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const {
      name,
      background,
      foreground,
      primary,
      primaryForeground,
      secondary,
      secondaryForeground,
      accent,
      accentForeground,
      muted,
      mutedForeground,
      border,
    } = body;

    // Validate required fields
    if (!name || !background || !foreground || !primary || !primaryForeground) {
      return NextResponse.json(
        { error: 'Missing required theme fields' },
        { status: 400 }
      );
    }

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

    // Check if user already has a custom theme
    const existingTheme = await prisma.theme.findFirst({
      where: { createdById: session.user.id },
    });

    let theme;
    if (existingTheme) {
      // Update existing theme
      theme = await prisma.theme.update({
        where: { id: existingTheme.id },
        data: {
          name,
          background,
          foreground,
          primary,
          primaryForeground,
          secondary,
          secondaryForeground,
          accent,
          accentForeground,
          muted,
          mutedForeground,
          border,
        },
      });
    } else {
      // Create new theme
      theme = await prisma.theme.create({
        data: {
          name,
          isPublic: false,
          createdById: session.user.id,
          background,
          foreground,
          primary,
          primaryForeground,
          secondary,
          secondaryForeground,
          accent,
          accentForeground,
          muted,
          mutedForeground,
          border,
        },
      });
    }

    return NextResponse.json(theme);
  } catch (error) {
    console.error('Error creating/updating theme:', error);
    return NextResponse.json({ error: 'Failed to save theme' }, { status: 500 });
  }
}
