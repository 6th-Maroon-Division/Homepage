// app/api/orbats/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';

type SubslotInput = {
  name: string;
  orderIndex: number;
  maxSignups: number;
};

type SlotInput = {
  name: string;
  orderIndex: number;
  subslots: SubslotInput[];
};

type OrbatInput = {
  name: string;
  description?: string;
  eventDate?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  slots: SlotInput[];
};

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session || !session.user?.isAdmin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body: OrbatInput = await request.json();

    // Validate input
    if (!body.name || !body.name.trim()) {
      return NextResponse.json({ error: 'OrbAT name is required' }, { status: 400 });
    }

    if (!body.slots || body.slots.length === 0) {
      return NextResponse.json({ error: 'At least one slot is required' }, { status: 400 });
    }

    // Prevent creating operations in the past
    if (body.eventDate) {
      const eventDate = new Date(body.eventDate);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      eventDate.setHours(0, 0, 0, 0);
      
      if (eventDate < today) {
        return NextResponse.json({ error: 'Cannot create operations with past dates' }, { status: 400 });
      }
    }

    // Create the OrbAT with all nested data
    const orbat = await prisma.orbat.create({
      data: {
        name: body.name.trim(),
        description: body.description?.trim() || null,
        eventDate: body.eventDate ? new Date(body.eventDate) : null,
        startTime: body.startTime || null,
        endTime: body.endTime || null,
        createdById: session.user.id,
        slots: {
          create: body.slots.map((slot) => ({
            name: slot.name.trim(),
            orderIndex: slot.orderIndex,
            subslots: {
              create: slot.subslots.map((subslot) => ({
                name: subslot.name.trim(),
                orderIndex: subslot.orderIndex,
                maxSignups: subslot.maxSignups,
              })),
            },
          })),
        },
      },
      include: {
        slots: {
          include: {
            subslots: true,
          },
        },
      },
    });

    return NextResponse.json(orbat, { status: 201 });
  } catch (error) {
    console.error('Error creating OrbAT:', error);
    return NextResponse.json({ error: 'Failed to create OrbAT' }, { status: 500 });
  }
}
