import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';

// GET /api/themes - Get all public themes and user's custom themes if logged in
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
        type: true,
        parentThemeId: true,
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
        button: true,
        buttonHover: true,
        buttonHoverForeground: true,
        customCss: true,
      },
      orderBy: [{ name: 'asc' }],
    });

    let customThemes: unknown[] = [];
    if (session?.user?.id) {
      customThemes = await prisma.theme.findMany({
        where: {
          createdById: session.user.id,
          isPublic: false,  // Only get user's private themes
        },
        select: {
          id: true,
          name: true,
          type: true,
          parentThemeId: true,
          isPublic: true,
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
          submissions: {
            select: {
              id: true,
              status: true,
              message: true,
              adminMessage: true,
              createdAt: true,
              snapshotName: true,
              snapshotBackground: true,
              snapshotForeground: true,
              snapshotPrimary: true,
              snapshotPrimaryForeground: true,
              snapshotSecondary: true,
              snapshotSecondaryForeground: true,
              snapshotAccent: true,
              snapshotAccentForeground: true,
              snapshotMuted: true,
              snapshotMutedForeground: true,
              snapshotBorder: true,
              snapshotCustomCss: true,
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
      });
    }

    return NextResponse.json({
      publicThemes,
      customThemes,
    });
  } catch (error) {
    console.error('Error fetching themes:', error);
    return NextResponse.json({ error: 'Failed to fetch themes' }, { status: 500 });
  }
}

// POST /api/themes - Create a new theme (original or derived)
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const {
      id,  // If provided, update existing theme
      name,
      type,  // 'original' or 'derived'
      parentThemeId,  // For derived themes
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
      customCss,
    } = body;

    // Validate required fields
    if (!name || !background || !foreground || !primary || !primaryForeground) {
      return NextResponse.json(
        { error: 'Missing required theme fields' },
        { status: 400 }
      );
    }

    let theme;
    
    if (id) {
      // Update existing theme - only allowed for derived themes
      const existing = await prisma.theme.findUnique({
        where: { id },
      });
      
      if (!existing) {
        return NextResponse.json({ error: 'Theme not found' }, { status: 404 });
      }
      
      if (existing.createdById !== session.user.id) {
        return NextResponse.json({ error: 'Not authorized to edit this theme' }, { status: 403 });
      }
      
      if (existing.isPublic) {
        return NextResponse.json(
          { error: 'Cannot edit themes after they become public' },
          { status: 403 }
        );
      }
      
      // Update theme
      theme = await prisma.theme.update({
        where: { id },
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
          button,
          buttonHover,
          buttonHoverForeground,
          customCss,
        },
      });
    } else {
      // Create new theme
      const themeType = type || (parentThemeId ? 'derived' : 'original');
      
      theme = await prisma.theme.create({
        data: {
          name,
          type: themeType,
          isPublic: false, // All new themes start as private
          parentThemeId: parentThemeId || null,
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
          button,
          buttonHover,
          buttonHoverForeground,
          customCss,
        },
      });
    }

    return NextResponse.json(theme);
  } catch (error) {
    console.error('Error creating/updating theme:', error);
    return NextResponse.json({ error: 'Failed to save theme' }, { status: 500 });
  }
}

// DELETE /api/themes?id=123 - Delete a user's theme
export async function DELETE(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const themeId = searchParams.get('id');
    
    if (!themeId) {
      return NextResponse.json({ error: 'Theme ID is required' }, { status: 400 });
    }

    // Find the theme
    const theme = await prisma.theme.findUnique({
      where: { id: parseInt(themeId) },
    });

    if (!theme) {
      return NextResponse.json({ error: 'Theme not found' }, { status: 404 });
    }
    
    // Check ownership
    if (theme.createdById !== session.user.id) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
    }

    // Can only delete private themes
    if (theme.isPublic) {
      return NextResponse.json(
        { error: 'Cannot delete public themes' },
        { status: 403 }
      );
    }

    // Delete the theme
    await prisma.theme.delete({
      where: { id: parseInt(themeId) },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting theme:', error);
    return NextResponse.json({ error: 'Failed to delete theme' }, { status: 500 });
  }
}
