// app/api/orbats/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';

type SubslotInput = {
  id?: number;
  name: string;
  orderIndex: number;
  maxSignups: number;
  _deleted?: boolean;
};

type SlotInput = {
  id?: number;
  name: string;
  orderIndex: number;
  subslots: SubslotInput[];
  _deleted?: boolean;
};

type OrbatUpdateInput = {
  name: string;
  description?: string;
  eventDate?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  slots: SlotInput[];
};

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session || !session.user?.isAdmin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const orbatId = parseInt(id);

    if (isNaN(orbatId)) {
      return NextResponse.json({ error: 'Invalid OrbAT ID' }, { status: 400 });
    }

    const body: OrbatUpdateInput = await request.json();

    // Validate input
    if (!body.name || !body.name.trim()) {
      return NextResponse.json({ error: 'OrbAT name is required' }, { status: 400 });
    }

    const activeSlots = body.slots.filter((s) => !s._deleted);
    if (activeSlots.length === 0) {
      return NextResponse.json({ error: 'At least one slot is required' }, { status: 400 });
    }

    // Check if OrbAT exists
    const existingOrbat = await prisma.orbat.findUnique({
      where: { id: orbatId },
      include: {
        slots: {
          include: {
            subslots: true,
          },
        },
      },
    });

    if (!existingOrbat) {
      return NextResponse.json({ error: 'OrbAT not found' }, { status: 404 });
    }

    // Process the update
    // 1. Update basic OrbAT info
    // 2. Handle slot deletions
    // 3. Handle slot updates/creates
    // 4. Handle subslot deletions
    // 5. Handle subslot updates/creates

    // Collect IDs to delete
    const slotsToDelete = body.slots.filter((s) => s._deleted && s.id).map((s) => s.id!);
    const subslotIdsToDelete: number[] = [];

    body.slots.forEach((slot) => {
      if (!slot._deleted) {
        slot.subslots
          .filter((sub) => sub._deleted && sub.id)
          .forEach((sub) => subslotIdsToDelete.push(sub.id!));
      }
    });

    // Perform update in transaction
    const updatedOrbat = await prisma.$transaction(async (tx) => {
      // Delete marked subslots
      if (subslotIdsToDelete.length > 0) {
        await tx.subslot.deleteMany({
          where: { id: { in: subslotIdsToDelete } },
        });
      }

      // Delete marked slots
      if (slotsToDelete.length > 0) {
        await tx.slot.deleteMany({
          where: { id: { in: slotsToDelete } },
        });
      }

      // Update OrbAT and process slots
      await tx.orbat.update({
        where: { id: orbatId },
        data: {
          name: body.name.trim(),
          description: body.description?.trim() || null,
          eventDate: body.eventDate ? new Date(body.eventDate) : null,
          startTime: body.startTime || null,
          endTime: body.endTime || null,
        },
      });

      // Process each slot
      for (const slotInput of body.slots.filter((s) => !s._deleted)) {
        if (slotInput.id) {
          // Update existing slot
          await tx.slot.update({
            where: { id: slotInput.id },
            data: {
              name: slotInput.name.trim(),
              orderIndex: slotInput.orderIndex,
            },
          });

          // Process subslots for this slot
          for (const subslotInput of slotInput.subslots.filter((s) => !s._deleted)) {
            if (subslotInput.id) {
              // Update existing subslot
              await tx.subslot.update({
                where: { id: subslotInput.id },
                data: {
                  name: subslotInput.name.trim(),
                  orderIndex: subslotInput.orderIndex,
                  maxSignups: subslotInput.maxSignups,
                },
              });
            } else {
              // Create new subslot
              await tx.subslot.create({
                data: {
                  slotId: slotInput.id,
                  name: subslotInput.name.trim(),
                  orderIndex: subslotInput.orderIndex,
                  maxSignups: subslotInput.maxSignups,
                },
              });
            }
          }
        } else {
          // Create new slot with subslots
          await tx.slot.create({
            data: {
              orbatId: orbatId,
              name: slotInput.name.trim(),
              orderIndex: slotInput.orderIndex,
              subslots: {
                create: slotInput.subslots
                  .filter((s) => !s._deleted)
                  .map((subslot) => ({
                    name: subslot.name.trim(),
                    orderIndex: subslot.orderIndex,
                    maxSignups: subslot.maxSignups,
                  })),
              },
            },
          });
        }
      }

      // Return updated OrbAT with relations
      return tx.orbat.findUnique({
        where: { id: orbatId },
        include: {
          slots: {
            orderBy: { orderIndex: 'asc' },
            include: {
              subslots: {
                orderBy: { orderIndex: 'asc' },
              },
            },
          },
        },
      });
    });

    return NextResponse.json(updatedOrbat);
  } catch (error) {
    console.error('Error updating OrbAT:', error);
    return NextResponse.json({ error: 'Failed to update OrbAT' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session || !session.user?.isAdmin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const orbatId = parseInt(id);

    if (isNaN(orbatId)) {
      return NextResponse.json({ error: 'Invalid OrbAT ID' }, { status: 400 });
    }

    // Check if OrbAT exists
    const existingOrbat = await prisma.orbat.findUnique({
      where: { id: orbatId },
    });

    if (!existingOrbat) {
      return NextResponse.json({ error: 'OrbAT not found' }, { status: 404 });
    }

    // Delete OrbAT (cascades to slots, subslots, and signups)
    await prisma.orbat.delete({
      where: { id: orbatId },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting OrbAT:', error);
    return NextResponse.json({ error: 'Failed to delete OrbAT' }, { status: 500 });
  }
}
