// app/api/subslots/[id]/signup/route.ts
import { NextResponse, type NextRequest } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';

type RouteParams = {
  params: Promise<{ id: string }>;
};

type SubslotWithSignupsAndUser = {
  id: number;
  name: string;
  orderIndex: number;
  maxSignups: number;
  signups: {
    id: number;
    user: {
      id: number;
      username: string | null;
    } | null;
  }[];
};

export async function POST(_req: NextRequest, context: RouteParams) {
  const { id } = await context.params;
  const subslotId = Number(id);

  if (Number.isNaN(subslotId)) {
    return NextResponse.json({ error: 'Invalid subslot id' }, { status: 400 });
  }

  // Get the current logged-in user from session
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return NextResponse.json(
      { error: 'You must be logged in to sign up.' },
      { status: 401 },
    );
  }

  const currentUserId = Number(session.user.id);

  // Load subslot + its orbat to check date, capacity, etc.
  const subslot = await prisma.subslot.findUnique({
    where: { id: subslotId },
    include: {
      slot: {
        include: { orbat: true },
      },
      signups: true,
    },
  });

  if (!subslot) {
    return NextResponse.json({ error: 'Subslot not found' }, { status: 404 });
  }

  const orbat = subslot.slot.orbat;
  const now = new Date();

  // Past ops cannot be signed up to
  if (orbat.eventDate && orbat.eventDate < now) {
    return NextResponse.json(
      { error: 'Operation is in the past. Signups are closed.' },
      { status: 400 },
    );
  }

  // Check if this user already signed up for this subslot
  const alreadySigned = await prisma.signup.findFirst({
    where: {
      subslotId,
      userId: currentUserId,
    },
  });

  if (alreadySigned) {
    return NextResponse.json(
      { error: 'You are already signed up for this slot.' },
      { status: 400 },
    );
  }

  // Check if user is already signed up anywhere in this ORBAT
  const existingSignupInOrbat = await prisma.signup.findFirst({
    where: {
      userId: currentUserId,
      subslot: {
        slot: {
          orbatId: subslot.slot.orbat.id,
        },
      },
    },
    include: {
      subslot: {
        include: {
          slot: true,
        },
      },
    },
  });

  if (existingSignupInOrbat) {
    return NextResponse.json(
      { error: `You are already signed up for "${existingSignupInOrbat.subslot.name}" in ${existingSignupInOrbat.subslot.slot.name}.` },
      { status: 400 },
    );
  }

  // Check if slot is full
  const currentCount = await prisma.signup.count({
    where: { subslotId },
  });

  if (currentCount >= subslot.maxSignups) {
    return NextResponse.json(
      { error: 'This slot is already full.' },
      { status: 400 },
    );
  }

  // Create signup
  await prisma.signup.create({
    data: {
      subslotId,
      userId: currentUserId,
    },
  });

  // Return updated subslot with users included
  const updatedSubslot = await prisma.subslot.findUnique({
    where: { id: subslotId },
    include: {
      signups: {
        include: { user: true },
      },
    },
  });

  if (!updatedSubslot) {
    return NextResponse.json(
      { error: 'Failed to load updated subslot.' },
      { status: 500 },
    );
  }

  const responseBody: SubslotWithSignupsAndUser = {
    id: updatedSubslot.id,
    name: updatedSubslot.name,
    orderIndex: updatedSubslot.orderIndex,
    maxSignups: updatedSubslot.maxSignups,
    signups: updatedSubslot.signups.map((s) => ({
      id: s.id,
      user: s.user
        ? {
            id: s.user.id,
            username: s.user.username,
          }
        : null,
    })),
  };

  return NextResponse.json(responseBody);
}

export async function DELETE(req: NextRequest, context: RouteParams) {
  const { id } = await context.params;
  const subslotId = Number(id);

  if (Number.isNaN(subslotId)) {
    return NextResponse.json({ error: 'Invalid subslot id' }, { status: 400 });
  }

  // Get the current logged-in user from session
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return NextResponse.json(
      { error: 'You must be logged in to remove a signup.' },
      { status: 401 },
    );
  }

  const currentUserId = Number(session.user.id);
  const isAdmin = session.user.isAdmin || false;

  // Load subslot to check if the operation is in the past
  const subslot = await prisma.subslot.findUnique({
    where: { id: subslotId },
    include: {
      slot: {
        include: { orbat: true },
      },
    },
  });

  if (!subslot) {
    return NextResponse.json({ error: 'Subslot not found' }, { status: 404 });
  }

  const orbat = subslot.slot.orbat;
  const now = new Date();

  // Past ops cannot be modified (unless admin)
  if (!isAdmin && orbat.eventDate && orbat.eventDate < now) {
    return NextResponse.json(
      { error: 'Operation is in the past. Signups cannot be modified.' },
      { status: 400 },
    );
  }

  // Admins can specify a signup ID to delete, otherwise delete current user's signup
  const body = await req.json().catch(() => ({}));
  const signupIdToDelete = body.signupId;

  let signup;

  if (isAdmin && signupIdToDelete) {
    // Admin removing a specific signup
    signup = await prisma.signup.findFirst({
      where: {
        id: Number(signupIdToDelete),
        subslotId,
      },
    });
  } else {
    // User removing their own signup
    signup = await prisma.signup.findFirst({
      where: {
        subslotId,
        userId: currentUserId,
      },
    });
  }

  if (!signup) {
    return NextResponse.json(
      { error: 'Signup not found.' },
      { status: 400 },
    );
  }

  // Delete the signup
  await prisma.signup.delete({
    where: { id: signup.id },
  });

  // Return updated subslot with users included
  const updatedSubslot = await prisma.subslot.findUnique({
    where: { id: subslotId },
    include: {
      signups: {
        include: { user: true },
      },
    },
  });

  if (!updatedSubslot) {
    return NextResponse.json(
      { error: 'Failed to load updated subslot.' },
      { status: 500 },
    );
  }

  const responseBody: SubslotWithSignupsAndUser = {
    id: updatedSubslot.id,
    name: updatedSubslot.name,
    orderIndex: updatedSubslot.orderIndex,
    maxSignups: updatedSubslot.maxSignups,
    signups: updatedSubslot.signups.map((s) => ({
      id: s.id,
      user: s.user
        ? {
            id: s.user.id,
            username: s.user.username,
          }
        : null,
    })),
  };

  return NextResponse.json(responseBody);
}
