import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth';import { authOptions } from '@/app/api/auth/[...nextauth]/route';import { NextResponse } from 'next/server';

export async function GET() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const templates = await (prisma as any).orbatTemplate.findMany({
      where: { isActive: true },
      include: {
        createdBy: {
          select: { id: true, username: true, avatarUrl: true },
        },
      },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });

    return NextResponse.json(templates);
  } catch (error) {
    console.error('Error fetching templates:', error);
    return NextResponse.json(
      { error: 'Failed to fetch templates' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.isAdmin) {
      return NextResponse.json(
        { error: 'Unauthorized - admin access required' },
        { status: 403 }
      );
    }

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
    } = data;

    // Validate required fields
    if (!name) {
      return NextResponse.json(
        { error: 'Template name is required' },
        { status: 400 }
      );
    }

    if (!slotsJson) {
      return NextResponse.json(
        { error: 'Slot structure is required' },
        { status: 400 }
      );
    }

    // Get admin user ID from session
    const userId = session.user?.id;
    if (!userId) {
      return NextResponse.json(
        { error: 'User ID not found in session' },
        { status: 403 }
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const template = await (prisma as any).orbatTemplate.create({
      data: {
        name,
        description: description || null,
        category: category || null,
        tagsJson: tagsJson || null,
        slotsJson,
        frequencyIds: frequencyIds || [],
        bluforCountry: bluforCountry || null,
        bluforRelationship: bluforRelationship || null,
        opforCountry: opforCountry || null,
        opforRelationship: opforRelationship || null,
        indepCountry: indepCountry || null,
        indepRelationship: indepRelationship || null,
        iedThreat: iedThreat || null,
        civilianRelationship: civilianRelationship || null,
        rulesOfEngagement: rulesOfEngagement || null,
        airspace: airspace || null,
        inGameTimezone: inGameTimezone || null,
        operationDay: operationDay || null,
        startTime: startTime || null,
        endTime: endTime || null,
        createdById: userId,
      },
      include: {
        createdBy: {
          select: { id: true, username: true, avatarUrl: true },
        },
      },
    });

    return NextResponse.json(template, { status: 201 });
  } catch (error) {
    console.error('Error creating template:', error);
    return NextResponse.json(
      { error: 'Failed to create template' },
      { status: 500 }
    );
  }
}
