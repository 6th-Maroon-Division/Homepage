import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';

// POST /api/themes/admin/submissions/[id]/approve - Approve a theme submission
export async function POST(
  request: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  const params = await props.params;
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.isAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const submissionId = parseInt(params.id);

    const submission = await prisma.themeSubmission.findUnique({
      where: { id: submissionId },
      include: { 
        theme: {
          include: {
            parentTheme: true
          }
        } 
      },
    });

    if (!submission) {
      return NextResponse.json({ error: 'Submission not found' }, { status: 404 });
    }

    // Update submission status
    await prisma.themeSubmission.update({
      where: { id: submissionId },
      data: {
        status: 'approved',
        reviewedAt: new Date(),
      },
    });

    // Handle based on submission type
    if (submission.submissionType === 'update' && submission.theme.parentThemeId) {
      // Update the parent theme with the snapshot data
      const updatedParentTheme = await prisma.theme.update({
        where: { id: submission.theme.parentThemeId },
        data: {
          name: submission.snapshotName,
          background: submission.snapshotBackground,
          foreground: submission.snapshotForeground,
          primary: submission.snapshotPrimary,
          primaryForeground: submission.snapshotPrimaryForeground,
          secondary: submission.snapshotSecondary,
          secondaryForeground: submission.snapshotSecondaryForeground,
          accent: submission.snapshotAccent,
          accentForeground: submission.snapshotAccentForeground,
          muted: submission.snapshotMuted,
          mutedForeground: submission.snapshotMutedForeground,
          border: submission.snapshotBorder,
          customCss: submission.snapshotCustomCss,
        },
      });

      // Optionally delete the derived theme since it was just a workspace for proposing changes
      await prisma.theme.delete({
        where: { id: submission.themeId },
      });

      return NextResponse.json({ submission, theme: updatedParentTheme });
    } else {
      // Make the theme public (for new theme submissions or original themes)
      const updatedTheme = await prisma.theme.update({
        where: { id: submission.themeId },
        data: {
          isPublic: true,
          // Apply all snapshot data to the theme
          name: submission.snapshotName,
          background: submission.snapshotBackground,
          foreground: submission.snapshotForeground,
          primary: submission.snapshotPrimary,
          primaryForeground: submission.snapshotPrimaryForeground,
          secondary: submission.snapshotSecondary,
          secondaryForeground: submission.snapshotSecondaryForeground,
          accent: submission.snapshotAccent,
          accentForeground: submission.snapshotAccentForeground,
          muted: submission.snapshotMuted,
          mutedForeground: submission.snapshotMutedForeground,
          border: submission.snapshotBorder,
          customCss: submission.snapshotCustomCss,
        },
      });

      return NextResponse.json({ submission, theme: updatedTheme });
    }
  } catch (error) {
    console.error('Error approving submission:', error);
    return NextResponse.json({ error: 'Failed to approve submission' }, { status: 500 });
  }
}
