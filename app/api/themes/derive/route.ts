import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';

// POST /api/themes/derive - Create a derived theme from a public theme
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { 
      parentThemeId,
      name,
      // Optional modifications
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
      customCss,
    } = body;

    if (!parentThemeId) {
      return NextResponse.json({ error: 'Parent theme ID is required' }, { status: 400 });
    }

    // Get parent theme
    const parentTheme = await prisma.theme.findUnique({
      where: { id: parentThemeId },
    });

    if (!parentTheme) {
      return NextResponse.json({ error: 'Parent theme not found' }, { status: 404 });
    }

    if (!parentTheme.isPublic) {
      return NextResponse.json(
        { error: 'Can only derive from public themes' },
        { status: 400 }
      );
    }

    // Create derived theme with parent theme's values as defaults
    const derivedTheme = await prisma.theme.create({
      data: {
        name: name || `${parentTheme.name} (Custom)`,
        type: 'derived',
        isPublic: false,
        parentThemeId: parentTheme.id,
        createdById: session.user.id,
        background: background || parentTheme.background,
        foreground: foreground || parentTheme.foreground,
        primary: primary || parentTheme.primary,
        primaryForeground: primaryForeground || parentTheme.primaryForeground,
        secondary: secondary || parentTheme.secondary,
        secondaryForeground: secondaryForeground || parentTheme.secondaryForeground,
        accent: accent || parentTheme.accent,
        accentForeground: accentForeground || parentTheme.accentForeground,
        muted: muted || parentTheme.muted,
        mutedForeground: mutedForeground || parentTheme.mutedForeground,
        border: border || parentTheme.border,
        customCss: customCss || parentTheme.customCss,
      },
    });

    return NextResponse.json(derivedTheme);
  } catch (error) {
    console.error('Error creating derived theme:', error);
    return NextResponse.json({ error: 'Failed to create derived theme' }, { status: 500 });
  }
}
