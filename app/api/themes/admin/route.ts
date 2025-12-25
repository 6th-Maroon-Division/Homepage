import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';

// GET /api/themes/admin - Get all themes and submissions (admin only)
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.isAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const themes = await prisma.theme.findMany({
      include: {
        createdBy: {
          select: {
            id: true,
            username: true,
          },
        },
        submissions: {
          include: {
            submittedBy: {
              select: {
                id: true,
                username: true,
              },
            },
          },
          orderBy: { createdAt: 'desc' },
        },
        parentTheme: {
          select: {
            id: true,
            name: true,
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
            button: true,
            buttonHover: true,
            buttonHoverForeground: true,
            customCss: true,
          },
        },
      },
      orderBy: [{ isPublic: 'desc' }, { name: 'asc' }],
    });

    return NextResponse.json(themes);
  } catch (error) {
    console.error('Error fetching themes for admin:', error);
    return NextResponse.json({ error: 'Failed to fetch themes' }, { status: 500 });
  }
}

// POST /api/themes/admin - Create a new public theme (admin only)
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.isAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
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
      button,
      buttonHover,
      buttonHoverForeground,
      isDefaultLight,
      isDefaultDark,
    } = body;

    // Validate required fields
    if (!name || !background || !foreground || !primary || !primaryForeground) {
      return NextResponse.json(
        { error: 'Missing required theme fields' },
        { status: 400 }
      );
    }

    // Check if theme with this name already exists
    const existingTheme = await prisma.theme.findFirst({
      where: { name, isPublic: true },
    });

    if (existingTheme) {
      return NextResponse.json(
        { error: 'Theme with this name already exists' },
        { status: 400 }
      );
    }

    const theme = await prisma.theme.create({
      data: {
        name,
        isPublic: true,
        isDefaultLight: isDefaultLight || false,
        isDefaultDark: isDefaultDark || false,
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
        button,
        buttonHover,
        buttonHoverForeground,
      },
    });

    return NextResponse.json(theme);
  } catch (error) {
    console.error('Error creating public theme:', error);
    return NextResponse.json({ error: 'Failed to create theme' }, { status: 500 });
  }
}
