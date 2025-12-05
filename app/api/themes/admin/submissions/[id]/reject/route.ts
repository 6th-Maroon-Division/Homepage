import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';

// POST /api/themes/admin/submissions/[id]/reject - Reject a theme submission
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

    const submission = await prisma.themeSubmission.update({
      where: { id: submissionId },
      data: {
        status: 'rejected',
        reviewedAt: new Date(),
      },
    });

    return NextResponse.json(submission);
  } catch (error) {
    console.error('Error rejecting submission:', error);
    return NextResponse.json({ error: 'Failed to reject submission' }, { status: 500 });
  }
}
