import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
  try {
    const frequencies = await prisma.radioFrequency.findMany({
      orderBy: [{ type: 'asc' }, { frequency: 'asc' }],
    });

    return NextResponse.json(frequencies);
  } catch (error) {
    console.error('Error fetching radio frequencies:', error);
    return NextResponse.json({ error: 'Failed to fetch radio frequencies' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const { frequency, type, isAdditional, channel, callsign } = body;

    if (!frequency || !type) {
      return NextResponse.json({ error: 'Frequency and type are required' }, { status: 400 });
    }

    const newFreq = await prisma.radioFrequency.create({
      data: {
        frequency,
        type,
        isAdditional: isAdditional || false,
        channel: channel || null,
        callsign: callsign || null,
      },
    });

    return NextResponse.json(newFreq, { status: 201 });
  } catch (error) {
    console.error('Error creating radio frequency:', error);
    return NextResponse.json({ error: 'Failed to create radio frequency' }, { status: 500 });
  }
}
