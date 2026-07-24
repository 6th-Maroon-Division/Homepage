import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import { getEligibleTrainingStaff, isTrainingStaff } from '@/lib/training-staff';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await isTrainingStaff(Number(session.user.id)))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const [users, staff] = await Promise.all([
    prisma.user.findMany({
      select: { id: true, username: true, avatarUrl: true },
      orderBy: [{ username: 'asc' }, { id: 'asc' }],
    }),
    getEligibleTrainingStaff(),
  ]);
  const staffIds = new Set(staff.map((user) => user.id));
  return NextResponse.json({
    users: users.map((user) => ({ ...user, isTrainer: staffIds.has(user.id) })),
  });
}
