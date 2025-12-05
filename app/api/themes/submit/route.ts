import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';

// POST /api/themes/submit - Submit theme changes for review
// Can be used for:
// 1. Submitting changes to a public theme (anyone can submit)
// 2. Submitting a derived theme for review
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { 
      themeId,  // The theme being modified (public theme or user's derived theme)
      message,
      submissionType = 'new',  // 'new' or 'update'
      // Snapshot data
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
      customCss,
    } = body;

    if (!themeId) {
      return NextResponse.json({ error: 'Theme ID is required' }, { status: 400 });
    }

    // Get the theme
    const theme = await prisma.theme.findUnique({
      where: { id: themeId },
      include: { 
        submissions: {
          where: {
            submittedById: session.user.id,
            status: 'pending'
          }
        }
      },
    });

    if (!theme) {
      return NextResponse.json({ error: 'Theme not found' }, { status: 404 });
    }

    // Check if user already has a pending submission for this theme
    if (theme.submissions.length > 0) {
      return NextResponse.json(
        { error: 'You already have a pending submission for this theme' },
        { status: 400 }
      );
    }

    // Create new submission with snapshot data
    const submission = await prisma.themeSubmission.create({
      data: {
        themeId: theme.id,
        submittedById: session.user.id,
        message,
        status: 'pending',
        submissionType,
        // Snapshot data
        snapshotName: name,
        snapshotBackground: background,
        snapshotForeground: foreground,
        snapshotPrimary: primary,
        snapshotPrimaryForeground: primaryForeground,
        snapshotSecondary: secondary,
        snapshotSecondaryForeground: secondaryForeground,
        snapshotAccent: accent,
        snapshotAccentForeground: accentForeground,
        snapshotMuted: muted,
        snapshotMutedForeground: mutedForeground,
        snapshotBorder: border,
        snapshotCustomCss: customCss || null,
      },
    });

    return NextResponse.json(submission);
  } catch (error) {
    console.error('Error submitting theme:', error);
    return NextResponse.json({ error: 'Failed to submit theme' }, { status: 500 });
  }
}
