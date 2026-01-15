import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';

/**
 * POST /api/attendance/legacy-import
 * Import legacy attendance matrix CSV (rows=users, cols=dates) to LegacyAttendanceData table
 * Expects matrix format with year in header and dates as columns
 * Status codes: P, A, NA, LOA, NO, EO
 */
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.isAdmin) {
    return NextResponse.json(
      { error: 'Unauthorized - admin access required' },
      { status: 401 }
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

    // Parse CSV matrix
    const lines = csvData.trim().split('\n');
    if (lines.length < 4) {
      return NextResponse.json(
        { error: 'CSV too short - need header rows with year and dates' },
        { status: 400 }
      );
    }

    // Extract year from header (look for "YEAR: 2025" pattern)
    let year = new Date().getFullYear();
    for (let i = 0; i < Math.min(5, lines.length); i++) {
      const yearMatch = lines[i].match(/YEAR:\s*(\d{4})/i);
      if (yearMatch) {
        year = parseInt(yearMatch[1]);
        break;
      }
    }

    // Find the header row with dates (look for row with "RANK,NAME,ID" or similar)
    let headerRowIndex = -1;
    const dateColumns: Array<{ index: number; date: Date; label: string }> = [];
    
    for (let i = 0; i < Math.min(10, lines.length); i++) {
      const parts = lines[i].split(',');
      if (parts.some((p: string) => p.trim().toLowerCase() === 'name')) {
        headerRowIndex = i;
        
        // Parse date columns (look for dates like "26-Dec", "2-Jan", etc.)
        for (let j = 0; j < parts.length; j++) {
          const cell = parts[j].trim();
          const dateMatch = cell.match(/(\d{1,2})-(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i);
          if (dateMatch) {
            const day = parseInt(dateMatch[1]);
            const monthStr = dateMatch[2];
            const monthMap: Record<string, number> = {
              jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
              jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11
            };
            const month = monthMap[monthStr.toLowerCase()];
            
            // Handle year wrap (if Dec appears and we're early in the year, it's previous year)
            let dateYear = year;
            if (month === 11 && dateColumns.length > 0) {
              // If we already have dates and this is December, it's from previous year
              dateYear = year - 1;
            }
            
            const date = new Date(dateYear, month, day);
            dateColumns.push({ index: j, date, label: cell });
          }
        }
        break;
      }
    }

    if (headerRowIndex === -1 || dateColumns.length === 0) {
      return NextResponse.json(
        { error: 'Could not find header row with dates. Expected format: RANK,NAME,ID,26-Dec,2-Jan,9-Jan...' },
        { status: 400 }
      );
    }

    // Find column indices for RANK and NAME
    const headerParts = lines[headerRowIndex].split(',');
    const rankIndex = headerParts.findIndex((p: string) => p.trim().toLowerCase() === 'rank');
    const nameIndex = headerParts.findIndex((p: string) => p.trim().toLowerCase() === 'name');

    if (rankIndex === -1 || nameIndex === -1) {
      return NextResponse.json(
        { error: 'Could not find RANK and NAME columns in header' },
        { status: 400 }
      );
    }

    const idIndex = headerParts.findIndex((p: string) => p.trim().toLowerCase() === 'id');

    const records = [];
    const errors: string[] = [];
    const validStatuses = ['P', 'A', 'NA'];
    let skippedCells = 0;
    let processedCells = 0;

    // Process data rows (skip header rows)
    for (let i = headerRowIndex + 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const parts = line.split(',');
      if (parts.length < nameIndex + 1) continue;

      const rank = parts[rankIndex]?.trim();
      const name = parts[nameIndex]?.trim();
      
      if (!name || !rank) continue;

      const legacyName = `${rank} ${name}`;
      const legacyUserId = idIndex !== -1 ? parts[idIndex]?.trim() : null;

      // Process each date column for this user
      for (const { index, date, label } of dateColumns) {
        if (index >= parts.length) continue;
        
        const status = parts[index]?.trim().toUpperCase();
        processedCells += 1;
        if (!status || !validStatuses.includes(status)) {
          skippedCells += 1;
          continue;
        }

        records.push({
          legacyName,
          legacyUserId,
          legacyStatus: status,
          legacyEventDate: date,
          legacyNotes: `Imported from ${label} attendance`,
        });
      }
    }

    if (records.length === 0) {
      return NextResponse.json(
        { 
          error: 'No valid records to import (all rows skipped: LOA/NO/EO or empty)',
          skippedCells,
          processedCells,
          details: errors,
        },
        { status: 400 }
      );
    }

    // Deduplicate and detect conflicts
    const recordsToCreate = [];
    const conflicts: Array<{
      legacyUserId: string;
      legacyEventDate: string;
      existing: string;
      new: string;
    }> = [];
    const duplicateCount = { same: 0, different: 0 };

    for (const record of records) {
      // Check if record with same userId, date, and status already exists
      const existing = await prisma.legacyAttendanceData.findFirst({
        where: {
          legacyUserId: record.legacyUserId,
          legacyEventDate: record.legacyEventDate,
          legacyStatus: record.legacyStatus,
        },
      });

      if (existing) {
        duplicateCount.same++;
        continue; // Skip if exact same record exists
      }

      // Check if different status for same userId on same date exists
      const differentStatus = await prisma.legacyAttendanceData.findFirst({
        where: {
          legacyUserId: record.legacyUserId,
          legacyEventDate: record.legacyEventDate,
          NOT: {
            legacyStatus: record.legacyStatus,
          },
        },
      });

      if (differentStatus) {
        duplicateCount.different++;
        // Add to conflicts instead of skipping - let user choose
        conflicts.push({
          legacyUserId: record.legacyUserId || 'unknown',
          legacyEventDate: record.legacyEventDate?.toISOString() || 'unknown',
          existing: differentStatus.legacyStatus,
          new: record.legacyStatus,
        });
        continue;
      }

      recordsToCreate.push(record);
    }

    // In preview, show conflicts to user
    if (previewOnly) {
      return NextResponse.json({
        success: true,
        preview: recordsToCreate,
        imported: recordsToCreate.length,
        year,
        dateColumns: dateColumns.length,
        skippedCells,
        processedCells,
        duplicates: duplicateCount,
        conflicts, // Show conflicts for user to resolve
        errors: errors.length > 0 ? errors : undefined,
      });
    }

    // If there are conflicts and not explicitly resolved, don't save yet
    if (conflicts.length > 0) {
      return NextResponse.json({
        success: false,
        hasConflicts: true,
        conflicts,
        recordsToCreate: recordsToCreate.length,
        duplicates: duplicateCount,
        message: 'Conflicts detected. Please resolve before importing.',
      });
    }

    if (recordsToCreate.length === 0) {
      return NextResponse.json(
        {
          error: 'All records are duplicates (already exist in database)',
          duplicates: duplicateCount,
          skippedCells,
          processedCells,
        },
        { status: 400 }
      );
    }

    // Create records in database
    const created = await prisma.legacyAttendanceData.createMany({
      data: recordsToCreate,
      skipDuplicates: false,
    });

    return NextResponse.json({
      success: true,
      imported: created.count,
      duplicates: duplicateCount,
      year,
      dateColumns: dateColumns.length,
      skippedCells,
      processedCells,
      errors: errors.length > 0 ? errors : undefined,
      message: `Imported ${created.count} legacy attendance records from ${dateColumns.length} dates in year ${year}.`,
    });
  } catch (error) {
    console.error('Legacy import error:', error);
    return NextResponse.json(
      { error: 'Failed to import legacy data' },
      { status: 500 }
    );
  }
}
