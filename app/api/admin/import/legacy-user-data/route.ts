// app/api/admin/import/legacy-user-data/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';

// POST - Upload and parse CSV to create LegacyUserData entries
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  try {
    const formData = await req.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    const text = await file.text();
    const lines = text.split('\n').filter((line) => line.trim());

    if (lines.length === 0) {
      return NextResponse.json({ error: 'Empty file' }, { status: 400 });
    }

    // Parse CSV header
    const header = lines[0].split(',').map((h) => h.trim());
    const expectedHeaders = ['ID', 'NAME', 'Rank', 'Date Joined', 'TIG Since Last Promo', 'TOTAL TIG', 'Old Data'];
    
    const headerMatch = expectedHeaders.every((h) => header.includes(h));
    if (!headerMatch) {
      return NextResponse.json(
        { error: 'Invalid CSV format. Expected headers: ' + expectedHeaders.join(', ') },
        { status: 400 }
      );
    }

    // Get all ranks for validation
    const ranks = await prisma.rank.findMany();
    const validRankNames = ranks.map((r) => r.abbreviation.toLowerCase());

    const records = [];
    const errors = [];

    // Parse data rows (skip header)
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const columns = line.split(',').map((col) => col.trim());
      
      if (columns.length < 7) {
        errors.push(`Row ${i + 1}: Insufficient columns (expected 7, got ${columns.length})`);
        continue;
      }

      const [legacyId, discordUsername, rankName, dateJoined, tigSinceLastPromo, totalTig, oldData] = columns;

      // Validate required fields
      if (!legacyId || !discordUsername || !rankName) {
        errors.push(`Row ${i + 1}: Missing required fields (ID, NAME, or Rank)`);
        continue;
      }

      // Validate rank exists
      const rankExists = validRankNames.includes(rankName.toLowerCase());
      if (!rankExists) {
        errors.push(`Row ${i + 1}: Unknown rank "${rankName}" for user ${discordUsername}`);
      }

      // Parse numeric fields
      const tigSinceLastPromoNum = parseInt(tigSinceLastPromo) || 0;
      const totalTigNum = parseInt(totalTig) || 0;
      const oldDataNum = parseInt(oldData) || 0;

      records.push({
        legacyId,
        discordUsername,
        rankName,
        dateJoined: dateJoined || null,
        tigSinceLastPromo: tigSinceLastPromoNum,
        totalTig: totalTigNum,
        oldData: oldDataNum,
        rankValid: rankExists,
      });
    }

    if (records.length === 0) {
      return NextResponse.json(
        { error: 'No valid records found in CSV', errors },
        { status: 400 }
      );
    }

    // Create LegacyUserData entries
    const created = await prisma.$transaction(
      records.map((record) =>
        prisma.legacyUserData.create({
          data: {
            legacyId: record.legacyId,
            discordUsername: record.discordUsername,
            rankName: record.rankName,
            dateJoined: record.dateJoined,
            tigSinceLastPromo: record.tigSinceLastPromo,
            totalTig: record.totalTig,
            oldData: record.oldData,
            notes: !record.rankValid ? `Invalid rank: ${record.rankName}` : null,
          },
        })
      )
    );

    // Try to auto-map by Discord username
    const users = await prisma.user.findMany({
      select: { id: true, username: true },
    });

    let autoMapped = 0;
    for (const legacyRecord of created) {
      const matchedUser = users.find(
        (u) => u.username?.toLowerCase() === legacyRecord.discordUsername.toLowerCase()
      );

      if (matchedUser) {
        await prisma.legacyUserData.update({
          where: { id: legacyRecord.id },
          data: {
            mappedUserId: matchedUser.id,
            isMapped: true,
          },
        });
        autoMapped++;
      }
    }

    return NextResponse.json({
      success: true,
      imported: created.length,
      autoMapped,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.error('Legacy user data import error:', error);
    return NextResponse.json(
      { error: 'Failed to import legacy user data' },
      { status: 500 }
    );
  }
}

// GET - List legacy user data with optional filters
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const page = parseInt(searchParams.get('page') || '1');
    const pageSize = parseInt(searchParams.get('pageSize') || '50');
    const isMapped = searchParams.get('isMapped');
    const isApplied = searchParams.get('isApplied');
    const rankName = searchParams.get('rankName');

    const where: {
      isMapped?: boolean;
      isApplied?: boolean;
      rankName?: { contains: string; mode: 'insensitive' };
    } = {};

    if (isMapped !== null) {
      where.isMapped = isMapped === 'true';
    }

    if (isApplied !== null) {
      where.isApplied = isApplied === 'true';
    }

    if (rankName) {
      where.rankName = { contains: rankName, mode: 'insensitive' };
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
