import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { NextResponse } from 'next/server';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const templateId = parseInt(id);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const template = await (prisma as any).orbatTemplate.findUnique({
      where: { id: templateId },
      include: {
        createdBy: {
          select: { id: true, username: true, avatarUrl: true },
        },
      },
    });

    if (!template) {
      return NextResponse.json(
        { error: 'Template not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(template);
  } catch (error) {
    console.error('Error fetching template:', error);
    return NextResponse.json(
      { error: 'Failed to fetch template' },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.isAdmin) {
      return NextResponse.json(
        { error: 'Unauthorized - admin access required' },
        { status: 403 }
      );
    }

    const { id } = await params;
    const templateId = parseInt(id);

    const data = await request.json();

    const {
      name,
      description,
      category,
      tagsJson,
      slotsJson,
      frequencyIds,
      bluforCountry,
      bluforRelationship,
      opforCountry,
      opforRelationship,
      indepCountry,
      indepRelationship,
      iedThreat,
      civilianRelationship,
      rulesOfEngagement,
      airspace,
      inGameTimezone,
      operationDay,
      startTime,
      endTime,
      isActive,
    } = data;

    // Verify template exists
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const existingTemplate = await (prisma as any).orbatTemplate.findUnique({
      where: { id: templateId },
    });

    if (!existingTemplate) {
      return NextResponse.json(
        { error: 'Template not found' },
        { status: 404 }
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const template = await (prisma as any).orbatTemplate.update({
      where: { id: templateId },
      data: {
        ...(name && { name }),
        ...(description !== undefined && { description }),
        ...(category !== undefined && { category }),
        ...(tagsJson !== undefined && { tagsJson }),
        ...(slotsJson && { slotsJson }),
        ...(frequencyIds && { frequencyIds }),
        ...(bluforCountry !== undefined && { bluforCountry }),
        ...(bluforRelationship !== undefined && { bluforRelationship }),
        ...(opforCountry !== undefined && { opforCountry }),
        ...(opforRelationship !== undefined && { opforRelationship }),
        ...(indepCountry !== undefined && { indepCountry }),
        ...(indepRelationship !== undefined && { indepRelationship }),
        ...(iedThreat !== undefined && { iedThreat }),
        ...(civilianRelationship !== undefined && { civilianRelationship }),
        ...(rulesOfEngagement !== undefined && { rulesOfEngagement }),
        ...(airspace !== undefined && { airspace }),
        ...(inGameTimezone !== undefined && { inGameTimezone }),
        ...(operationDay !== undefined && { operationDay }),
        ...(startTime !== undefined && { startTime }),
        ...(endTime !== undefined && { endTime }),
        ...(isActive !== undefined && { isActive }),
        updatedAt: new Date(),
      },
      include: {
        createdBy: {
          select: { id: true, username: true, avatarUrl: true },
        },
      },
    });

    return NextResponse.json(template);
  } catch (error) {
    console.error('Error updating template:', error);
    return NextResponse.json(
      { error: 'Failed to update template' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.isAdmin) {
      return NextResponse.json(
        { error: 'Unauthorized - admin access required' },
        { status: 403 }
      );
    }

    const { id } = await params;
    const templateId = parseInt(id);

    // Soft delete by marking as inactive instead of hard delete
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (prisma as any).orbatTemplate.update({
      where: { id: templateId },
      data: { isActive: false },
    });

    return NextResponse.json(
      { message: 'Template deleted successfully' },
      { status: 200 }
    );
  } catch (error) {
    console.error('Error deleting template:', error);
    return NextResponse.json(
      { error: 'Failed to delete template' },
      { status: 500 }
    );
  }
}
