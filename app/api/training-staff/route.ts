import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { getEligibleTrainingStaff, isTrainingStaff } from '@/lib/training-staff';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!(await isTrainingStaff(Number(session.user.id)))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const staff = await getEligibleTrainingStaff();
  return NextResponse.json({ staff });
}
