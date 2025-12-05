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
      include: { theme: true },
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

    // Make the theme public
    const updatedTheme = await prisma.theme.update({
      where: { id: submission.themeId },
      data: { isPublic: true },
    });

    return NextResponse.json({ submission, theme: updatedTheme });
  } catch (error) {
    console.error('Error approving submission:', error);
    return NextResponse.json({ error: 'Failed to approve submission' }, { status: 500 });
  }
}
