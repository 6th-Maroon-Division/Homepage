// app/api/users/[id]/admin/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  await params;
  await request.text();
  return NextResponse.json(
    {
      error:
        'Admin status toggles are deprecated. Manage system-level access via permission values (system:super_admin).',
    },
    { status: 410 }
  );
}
