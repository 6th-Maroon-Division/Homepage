import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
  try {
    const orbats = await prisma.orbat.findMany({
      orderBy: [
        { startsAtUtc: 'asc' },
        { eventDate: 'asc' },
        { createdAt: 'asc' },
      ],
      select: {
        id: true,
        name: true,
        description: true,
        startsAtUtc: true,
        eventDate: true,
        createdAt: true,
      },
    });

    const items = orbats.map((orbat) => {
      const date = orbat.startsAtUtc ?? orbat.eventDate ?? orbat.createdAt;
      const year = date.getUTCFullYear();
      const month = `${date.getUTCMonth() + 1}`.padStart(2, '0');
      const day = `${date.getUTCDate()}`.padStart(2, '0');

      return {
        id: orbat.id,
        name: orbat.name,
        description: orbat.description,
        eventDate: date.toISOString(),
        dateKey: `${year}-${month}-${day}`,
      };
    });

    return NextResponse.json(items);
  } catch (error) {
    console.error('Error fetching ORBAT calendar feed:', error);
    return NextResponse.json({ error: 'Failed to fetch ORBAT calendar feed' }, { status: 500 });
  }
}