import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const page = Number(searchParams.get('page')) || 1;
  const limit = Number(searchParams.get('limit')) || 50;
  const interview = searchParams.get('interview'); // 'done', 'notDone', 'all'
  const bct = searchParams.get('bct'); // 'done', 'notDone', 'all'
  const retired = searchParams.get('retired'); // 'active', 'retired', 'all'
  const sort = searchParams.get('sort') || 'username'; // 'username', 'id'

  const skip = (page - 1) * limit;

  // Get all trainings required for new people
  const requiredTrainings = await prisma.training.findMany({
    where: { requiredForNewPeople: true },
    select: { id: true },
  });

  // Get users who need required trainings (missing any or needsRetraining)
  let usersNeedingTraining: number[] = [];
  if (requiredTrainings.length > 0) {
    const allUsers = await prisma.user.findMany({
      select: { id: true },
    });

    const userTrainings = await prisma.userTraining.findMany({
      where: { trainingId: { in: requiredTrainings.map((t) => t.id) } },
      select: { userId: true, trainingId: true, needsRetraining: true },
    });

    // Group by userId and check if they have all required trainings completed
    const userTrainingMap = new Map<number, Set<number>>();
    userTrainings.forEach((ut) => {
      if (!ut.needsRetraining) {
        if (!userTrainingMap.has(ut.userId)) {
          userTrainingMap.set(ut.userId, new Set());
        }
        userTrainingMap.get(ut.userId)!.add(ut.trainingId);
      }
    });

    // Users who don't have all required trainings
    usersNeedingTraining = allUsers
      .filter((u) => {
        const completedTrainings = userTrainingMap.get(u.id);
        return !completedTrainings || completedTrainings.size < requiredTrainings.length;
      })
      .map((u) => u.id);
  }

  // Build where clause - users without rank OR users needing required trainings
  const where: Record<string, any> = {
    OR: [
      { userRank: null },
      { userRank: { currentRankId: null } },
      { id: { in: usersNeedingTraining } },
    ],
  };

  // Apply interview filter
  if (interview && interview !== 'all') {
    where.AND = where.AND || [];
    if (interview === 'done') {
      where.AND.push({ userRank: { interviewDone: true } });
    } else {
      where.AND.push({
        OR: [
          { userRank: null },
          { userRank: { interviewDone: false } },
        ],
      });
    }
  }

  // Apply retired filter
  if (retired && retired !== 'all') {
    where.AND = where.AND || [];
    if (retired === 'retired') {
      where.AND.push({ userRank: { retired: true } });
    } else {
      where.AND.push({
        OR: [
          { userRank: null },
          { userRank: { retired: false } },
        ],
      });
    }
  }

  // Required trainings filter - check if user has all trainings
  if (bct && bct !== 'all') {
    where.AND = where.AND || [];
    if (bct === 'done') {
      // Users who are NOT in the usersNeedingTraining list (have all trainings)
      where.AND.push({ id: { notIn: usersNeedingTraining.length > 0 ? usersNeedingTraining : [-1] } });
    } else {
      // Users who ARE in the usersNeedingTraining list (missing trainings)
      where.AND.push({ id: { in: usersNeedingTraining.length > 0 ? usersNeedingTraining : [-1] } });
    }
  }

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: {
        id: true,
        username: true,
        email: true,
        userRank: {
          select: {
            interviewDone: true,
            retired: true,
          },
        },
      },
      orderBy: sort === 'id' ? { id: 'asc' } : { username: 'asc' },
      skip,
      take: limit,
    }),
    prisma.user.count({ where }),
  ]);

  // Fetch attendance and required trainings for each user
  const attendanceData = await prisma.attendance.groupBy({
    by: ['userId'],
    where: { userId: { in: users.map((u) => u.id) } },
    _count: { id: true },
  });

  const attendanceMap = new Map(attendanceData.map((a) => [a.userId, a._count.id]));

  // Check if users have all required trainings completed
  let bctMap: Map<number, boolean> = new Map();
  if (requiredTrainings.length > 0) {
    const userTrainings = await prisma.userTraining.findMany({
      where: {
        trainingId: { in: requiredTrainings.map((t) => t.id) },
        userId: { in: users.map((u) => u.id) },
      },
      select: { userId: true, trainingId: true, needsRetraining: true },
    });

    // Group by userId and check if they have all required trainings completed
    const userTrainingMap = new Map<number, Set<number>>();
    userTrainings.forEach((ut) => {
      if (!ut.needsRetraining) {
        if (!userTrainingMap.has(ut.userId)) {
          userTrainingMap.set(ut.userId, new Set());
        }
        userTrainingMap.get(ut.userId)!.add(ut.trainingId);
      }
    });

    // Mark users as completed if they have all required trainings
    users.forEach((user) => {
      const completedTrainings = userTrainingMap.get(user.id);
      const hasAllTrainings = completedTrainings && completedTrainings.size === requiredTrainings.length;
      bctMap.set(user.id, hasAllTrainings);
    });
  }

  const payload = users.map((u) => ({
    ...u,
    attendanceTotal: attendanceMap.get(u.id) || 0,
    bctCompleted: bctMap.get(u.id) || false,
  }));

  return NextResponse.json({
    users: payload,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  });
}
