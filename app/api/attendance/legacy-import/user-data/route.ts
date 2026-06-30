// app/api/attendance/legacy-import/user-data/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import { checkPermission } from '@/lib/auth-middleware';

/**
 * POST /api/attendance/legacy-import/user-data
 * Import legacy user data CSV (ID,NAME,Rank,Date Joined,TIG Since Last Promo,TOTAL TIG,Old Data)
 * to LegacyUserData table - following same pattern as attendance matrix import
 */
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }
  
  const hasPermission = await checkPermission(session.user.id, 'attendance:edit');
  if (!hasPermission) {
    return NextResponse.json(
      { error: 'Forbidden' },
      { status: 403 }
    );
  }

  try {
    const { csvData, previewOnly } = await request.json();

    if (!csvData) {
      return NextResponse.json(
        { error: 'Missing csvData' },
        { status: 400 }
      );
    }

    // Parse CSV
    const lines = csvData.trim().split('\n');
    if (lines.length < 2) {
      return NextResponse.json(
        { error: 'CSV too short - need header row and data rows' },
        { status: 400 }
      );
    }

    // Parse header
    const header = lines[0].split(',').map((h: string) => h.trim());
    const expectedHeaders = ['ID', 'NAME', 'Rank', 'Date Joined', 'TIG Since Last Promo', 'TOTAL TIG', 'Old Data'];
    
    const headerMatch = expectedHeaders.every((h) => header.includes(h));
    if (!headerMatch) {
      return NextResponse.json(
        { error: 'Invalid CSV format. Expected headers: ' + expectedHeaders.join(', ') },
        { status: 400 }
      );
    }

    // Find column indices
    const idIndex = header.findIndex((p: string) => p.trim().toLowerCase() === 'id');
    const nameIndex = header.findIndex((p: string) => p.trim().toLowerCase() === 'name');
    const rankIndex = header.findIndex((p: string) => p.trim().toLowerCase() === 'rank');
    const dateJoinedIndex = header.findIndex((p: string) => p.trim().toLowerCase() === 'date joined');
    const tigSinceLastPromoIndex = header.findIndex((p: string) => p.trim().toLowerCase() === 'tig since last promo');
    const totalTigIndex = header.findIndex((p: string) => p.trim().toLowerCase() === 'total tig');
    const oldDataIndex = header.findIndex((p: string) => p.trim().toLowerCase() === 'old data');

    if (idIndex === -1 || nameIndex === -1 || rankIndex === -1) {
      return NextResponse.json(
        { error: 'Could not find required columns: ID, NAME, Rank' },
        { status: 400 }
      );
    }

    const records = [];
    const errors: string[] = [];

    // Parse data rows (skip header)
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const columns = line.split(',').map((col: string) => col.trim());
      
      if (columns.length < 7) {
        errors.push(`Row ${i + 1}: Insufficient columns (expected 7, got ${columns.length})`);
        continue;
      }

      const legacyId = columns[idIndex] || '';
      const discordUsername = columns[nameIndex] || '';
      const rankName = columns[rankIndex] || '';
      const dateJoined = dateJoinedIndex !== -1 ? columns[dateJoinedIndex] || null : null;
      const tigSinceLastPromo = tigSinceLastPromoIndex !== -1 ? parseInt(columns[tigSinceLastPromoIndex]) || 0 : 0;
      const totalTig = totalTigIndex !== -1 ? parseInt(columns[totalTigIndex]) || 0 : 0;
      const oldData = oldDataIndex !== -1 ? parseInt(columns[oldDataIndex]) || 0 : 0;

      // Validate required fields
      if (!legacyId || !discordUsername || !rankName) {
        errors.push(`Row ${i + 1}: Missing required fields (ID, NAME, or Rank)`);
        continue;
      }

      records.push({
        legacyId,
        discordUsername,
        rankName,
        dateJoined,
        tigSinceLastPromo,
        totalTig,
        oldData,
      });
    }

    if (records.length === 0) {
      return NextResponse.json(
        { error: 'No valid records found in CSV', errors },
        { status: 400 }
      );
    }

    // Deduplicate and detect conflicts
    const recordsToCreate = [];
    const duplicates: Array<{ legacyId: string; discordUsername: string }> = [];

    for (const record of records) {
      // Check if record with same legacyId already exists
      const existing = await prisma.legacyUserData.findFirst({
        where: { legacyId: record.legacyId },
      });

      if (existing) {
        duplicates.push({ legacyId: record.legacyId, discordUsername: record.discordUsername });
        continue;
      }

      recordsToCreate.push(record);
    }

    // In preview, show results to user
    if (previewOnly) {
      return NextResponse.json({
        success: true,
        preview: recordsToCreate,
        imported: recordsToCreate.length,
        duplicates,
        errors: errors.length > 0 ? errors : undefined,
        message: `Preview: ${recordsToCreate.length} records ready to import, ${duplicates.length} duplicates would be skipped`,
      });
    }

    if (recordsToCreate.length === 0) {
      return NextResponse.json(
        {
          error: 'All records are duplicates (already exist in database)',
          duplicates,
          errors: errors.length > 0 ? errors : undefined,
        },
        { status: 400 }
      );
    }

    // Create records in database
    const created = await prisma.legacyUserData.createMany({
      data: recordsToCreate,
      skipDuplicates: false,
    });

    return NextResponse.json({
      success: true,
      imported: created.count,
      duplicates: duplicates.length,
      errors: errors.length > 0 ? errors : undefined,
      message: `Imported ${created.count} legacy user data records to database. ${duplicates.length} duplicates skipped.`,
    });
  } catch (error) {
    console.error('Legacy user data import error:', error);
    return NextResponse.json(
      { error: 'Failed to import legacy user data' },
      { status: 500 }
    );
  }
}

// GET - List all legacy user data with filters
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }
  
  const hasPermission = await checkPermission(session.user.id, 'attendance:view');
  if (!hasPermission) {
    return NextResponse.json(
      { error: 'Forbidden' },
      { status: 403 }
    );
  }

  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const pageSize = parseInt(searchParams.get('pageSize') || '10000'); // High limit for mapping UI
    const isMapped = searchParams.get('isMapped');
    const isApplied = searchParams.get('isApplied');
    const legacyId = searchParams.get('legacyId');
    const discordUsername = searchParams.get('discordUsername');
    const search = searchParams.get('search') || '';

    const where: {
      isMapped?: boolean;
      isApplied?: boolean;
      legacyId?: { contains: string; mode: 'insensitive' };
      discordUsername?: { contains: string; mode: 'insensitive' };
    } = {};

    if (isMapped !== null) {
      where.isMapped = isMapped === 'true';
    }

    if (isApplied !== null) {
      where.isApplied = isApplied === 'true';
    }

    if (legacyId) {
      where.legacyId = { contains: legacyId, mode: 'insensitive' };
    }

    if (discordUsername) {
      where.discordUsername = { contains: discordUsername, mode: 'insensitive' };
    }

    if (search) {
      where.discordUsername = { contains: search, mode: 'insensitive' };
    }

    const [records, total] = await Promise.all([
      prisma.legacyUserData.findMany({
        where,
        include: {
          mappedUser: {
            select: { id: true, username: true },
          },
        },
        orderBy: [{ isMapped: 'asc' }, { discordUsername: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.legacyUserData.count({ where }),
    ]);

    // Get all users for mapping suggestions
    const allUsers = await prisma.user.findMany({
      select: { id: true, username: true },
      orderBy: { username: 'asc' },
    });

    return NextResponse.json({
      records,
      users: allUsers,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  } catch (error) {
    console.error('Failed to fetch legacy user data:', error);
    return NextResponse.json(
      { error: 'Failed to fetch legacy user data' },
      { status: 500 }
    );
  }
}