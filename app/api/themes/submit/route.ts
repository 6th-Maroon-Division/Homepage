import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';

// POST /api/themes/submit - Submit user's custom theme for review
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { message } = body;

    // Get user's custom theme
    const customTheme = await prisma.theme.findFirst({
      where: { createdById: session.user.id },
      include: { submissions: true },
    });

    if (!customTheme) {
      return NextResponse.json({ error: 'No custom theme found' }, { status: 404 });
    }

    // Check if there's already a pending submission
    const pendingSubmission = customTheme.submissions.find(
      (s) => s.status === 'pending'
    );

    if (pendingSubmission) {
      return NextResponse.json(
        { error: 'You already have a pending submission' },
        { status: 400 }
      );
    }

    // Create new submission
    const submission = await prisma.themeSubmission.create({
      data: {
        themeId: customTheme.id,
        submittedById: session.user.id,
        message,
        status: 'pending',
      },
    });

    return NextResponse.json(submission);
  } catch (error) {
    console.error('Error submitting theme:', error);
    return NextResponse.json({ error: 'Failed to submit theme' }, { status: 500 });
  }
}
