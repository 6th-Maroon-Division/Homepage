// app/api/orbats/[id]/full/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const orbatId = parseInt(id);

    if (isNaN(orbatId)) {
      return NextResponse.json({ error: 'Invalid OrbAT ID' }, { status: 400 });
    }

    const orbat = await prisma.orbat.findUnique({
      where: { id: orbatId },
      include: {
        slots: {
          orderBy: { orderIndex: 'asc' },
          include: {
            subslots: {
              orderBy: { orderIndex: 'asc' },
              include: {
                signups: {
                  include: { user: true },
                },
              },
            },
          },
        },
        frequencies: {
          include: {
            radioFrequency: true,
          },
        },
      },
    });

    if (!orbat) {
      return NextResponse.json({ error: 'OrbAT not found' }, { status: 404 });
    }

    // Serialize for client
    const clientOrbat = {
      id: orbat.id,
      name: orbat.name,
      description: orbat.description,
      eventDate: orbat.eventDate ? orbat.eventDate.toISOString() : null,
      startTime: orbat.startTime || null,
      endTime: orbat.endTime || null,
      slots: orbat.slots.map((slot) => ({
        id: slot.id,
        name: slot.name,
        orderIndex: slot.orderIndex,
        subslots: slot.subslots.map((sub) => ({
          id: sub.id,
          name: sub.name,
          orderIndex: sub.orderIndex,
          maxSignups: sub.maxSignups,
          signups: sub.signups.map((s) => ({
            id: s.id,
            user: s.user
              ? {
                  id: s.user.id,
                  username: s.user.username ?? 'Unknown',
                }
              : null,
          })),
        })),
      })),
      frequencies: orbat.frequencies,
      tempFrequencies: orbat.tempFrequencies,
    };

    return NextResponse.json(clientOrbat);
  } catch (error) {
    console.error('Error fetching OrbAT:', error);
    return NextResponse.json({ error: 'Failed to fetch OrbAT' }, { status: 500 });
  }
}
