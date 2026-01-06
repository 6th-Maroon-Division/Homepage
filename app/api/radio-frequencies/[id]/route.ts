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
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const freqId = parseInt(id);

    if (isNaN(freqId)) {
      return NextResponse.json({ error: 'Invalid ID' }, { status: 400 });
    }

    const body = await request.json();
    const { frequency, type, isAdditional, channel, callsign } = body;

    // Check if frequency exists
    const existingFreq = await prisma.radioFrequency.findUnique({
      where: { id: freqId },
    });

    if (!existingFreq) {
      return NextResponse.json({ error: 'Frequency not found' }, { status: 404 });
    }

    // Update the frequency
    const updatedFreq = await prisma.radioFrequency.update({
      where: { id: freqId },
      data: {
        ...(frequency && { frequency }),
        ...(type && { type }),
        ...(isAdditional !== undefined && { isAdditional }),
        ...(channel !== undefined && { channel: channel || null }),
        ...(callsign !== undefined && { callsign: callsign || null }),
      },
    });

    return NextResponse.json(updatedFreq);
  } catch (error) {
    console.error('Error updating radio frequency:', error);
    return NextResponse.json({ error: 'Failed to update frequency' }, { status: 500 });
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
    const freqId = parseInt(id);

    if (isNaN(freqId)) {
      return NextResponse.json({ error: 'Invalid ID' }, { status: 400 });
    }

    // Check if frequency exists
    const freq = await prisma.radioFrequency.findUnique({
      where: { id: freqId },
    });

    if (!freq) {
      return NextResponse.json({ error: 'Frequency not found' }, { status: 404 });
    }

    // Delete the frequency (will set radioFrequencyId to NULL on subslots due to SetNull)
    await prisma.radioFrequency.delete({
      where: { id: freqId },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting radio frequency:', error);
    return NextResponse.json({ error: 'Failed to delete frequency' }, { status: 500 });
  }
}
