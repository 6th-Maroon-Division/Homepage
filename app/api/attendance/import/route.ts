import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';

interface ImportRecord {
  username: string;
  date: string;
  status: string; // P, A, NA, LOA, NO, EO
}

// Map old status codes to new attendance statuses
function mapOldStatus(oldStatus: string): 'present' | 'absent' | null {
  const status = oldStatus.toUpperCase().trim();
  switch (status) {
    case 'P':
      return 'present';
    case 'A':
    case 'NA': // Noted Absence
    case 'LOA': // Leave of Absence
      return 'absent';
    case 'NO': // No Operation
    case 'EO': // Event Operation
      return null; // Skip - no operation
    default:
      return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.isAdmin) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { records, orbatId } = body as { records: ImportRecord[]; orbatId: number };

    if (!Array.isArray(records) || !orbatId) {
      return NextResponse.json(
        { error: 'Invalid request format' },
        { status: 400 }
      );
    }

    let imported = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const record of records) {
      try {
        const { username, date, status: oldStatus } = record;

        if (!username || !date || !oldStatus) {
          skipped++;
          errors.push(`Skipped: Missing required fields for record`);
          continue;
        }

        // Map old status
        const newStatus = mapOldStatus(oldStatus);
        if (newStatus === null) {
          // Skip NO and EO records
          skipped++;
          continue;
        }

        // Find user by username
        const user = await prisma.user.findFirst({
          where: { username },
        });

        if (!user) {
          skipped++;
          errors.push(`Skipped: User "${username}" not found`);
          continue;
        }

        // Parse date
        const eventDate = new Date(date);
        if (isNaN(eventDate.getTime())) {
          skipped++;
          errors.push(`Skipped: Invalid date format for "${username}" on "${date}"`);
          continue;
        }

        // Find signup for this user on this date
        const signup = await prisma.signup.findFirst({
          where: {
            userId: user.id,
            subslot: {
              slot: {
                orbat: {
                  eventDate: {
                    gte: new Date(eventDate.toDateString()),
                    lt: new Date(new Date(eventDate).setDate(eventDate.getDate() + 1)),
                  },
                },
              },
            },
          },
        });

        if (!signup) {
          skipped++;
          errors.push(`Skipped: No signup found for "${username}" on "${date}"`);
          continue;
        }

        // Create attendance record
        await prisma.attendance.create({
          data: {
            userId: user.id,
            signupId: signup.id,
            orbatId,
            status: newStatus,
            minutesLate: 0,
            minutesGoneEarly: 0,
            totalMinutesMissed: 0,
            totalMinutesPresent: 0,
            notes: `Imported from legacy system - original status: ${oldStatus}`,
          },
        });

        // Log the import
        const createdAttendance = await prisma.attendance.findFirst({
          where: {
            signupId: signup.id,
            orbatId,
          },
          select: { id: true },
        });

        if (createdAttendance) {
          await prisma.attendanceLog.create({
            data: {
              attendanceId: createdAttendance.id,
              action: 'imported',
              source: 'legacy_import',
              changedById: session.user?.id,
              previousValue: JSON.parse(JSON.stringify({})),
              newValue: JSON.parse(JSON.stringify({ oldStatus, mappedStatus: newStatus })),
            },
          });
        }

        imported++;
      } catch (error) {
        skipped++;
        errors.push(`Error processing record: ${error}`);
      }
    }

    return NextResponse.json({
      success: true,
      imported,
      skipped,
      errors: errors.slice(0, 10), // Return first 10 errors
      total: records.length,
    });
  } catch (error) {
    console.error('Error importing attendance:', error);
    return NextResponse.json(
      { error: 'Failed to import attendance records' },
      { status: 500 }
    );
  }
}
