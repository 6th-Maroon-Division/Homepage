// app/api/signups/[id]/move/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session || !session.user?.isAdmin) {
      return NextResponse.json({ error: 'Unauthorized - Admin only' }, { status: 401 });
    }

    const { id } = await params;
    const signupId = parseInt(id);

    if (isNaN(signupId)) {
      return NextResponse.json({ error: 'Invalid signup ID' }, { status: 400 });
    }

    const body = await request.json();
    const { targetSubslotId } = body;

    if (!targetSubslotId || isNaN(parseInt(targetSubslotId))) {
      return NextResponse.json({ error: 'Target subslot ID is required' }, { status: 400 });
    }

    const targetId = parseInt(targetSubslotId);

    // Verify signup exists
    const signup = await prisma.signup.findUnique({
      where: { id: signupId },
      include: {
        subslot: true,
      },
    });

    if (!signup) {
      return NextResponse.json({ error: 'Signup not found' }, { status: 404 });
    }

    // Verify target subslot exists
    const targetSubslot = await prisma.subslot.findUnique({
      where: { id: targetId },
      include: {
        signups: true,
      },
    });

    if (!targetSubslot) {
      return NextResponse.json({ error: 'Target subslot not found' }, { status: 404 });
    }

    // Check if target subslot is full
    if (targetSubslot.signups.length >= targetSubslot.maxSignups) {
      return NextResponse.json({ error: 'Target subslot is full' }, { status: 400 });
    }

    // Check if user already signed up in target subslot
    const existingSignup = targetSubslot.signups.find((s) => s.userId === signup.userId);
    if (existingSignup) {
      return NextResponse.json(
        { error: 'User already signed up in target subslot' },
        { status: 400 }
      );
    }

    // Move the signup
    const updatedSignup = await prisma.signup.update({
      where: { id: signupId },
      data: {
        subslotId: targetId,
      },
      include: {
        user: true,
        subslot: {
          include: {
            slot: true,
          },
        },
      },
    });

    return NextResponse.json(updatedSignup);
  } catch (error) {
    console.error('Error moving signup:', error);
    return NextResponse.json({ error: 'Failed to move signup' }, { status: 500 });
  }
}
