import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';

// Detect cycles in training prerequisite graph using DFS
async function hasCycle(trainingId: number, requiredTrainingId: number): Promise<boolean> {
  const visited = new Set<number>();
  const recStack = new Set<number>();

  async function dfs(currentId: number): Promise<boolean> {
    visited.add(currentId);
    recStack.add(currentId);

    // Get all trainings that this training requires
    const prerequisites = await prisma.trainingTrainingRequirement.findMany({
      where: { trainingId: currentId },
      select: { requiredTrainingId: true },
    });

    for (const prereq of prerequisites) {
      const nextId = prereq.requiredTrainingId;
      
      if (!visited.has(nextId)) {
        if (await dfs(nextId)) {
          return true;
        }
      } else if (recStack.has(nextId)) {
        return true; // Cycle detected
      }
    }

    recStack.delete(currentId);
    return false;
  }

  // Simulate adding the new edge
  // Check if adding requiredTrainingId as a prerequisite creates a cycle
  // This means checking if trainingId is reachable from requiredTrainingId
  visited.clear();
  recStack.clear();
  
  // Start DFS from the required training to see if we can reach the training that needs it
  return await dfs(requiredTrainingId);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id } = await params;
  const trainingId = Number(id);
  if (isNaN(trainingId)) {
    return NextResponse.json({ error: 'Invalid training ID' }, { status: 400 });
  }

  const { requiredTrainingId } = await request.json();
  if (!requiredTrainingId || isNaN(Number(requiredTrainingId))) {
    return NextResponse.json({ error: 'requiredTrainingId required' }, { status: 400 });
  }

  const parsedRequiredId = Number(requiredTrainingId);

  if (trainingId === parsedRequiredId) {
    return NextResponse.json({ error: 'Training cannot require itself' }, { status: 400 });
  }

  const [training, requiredTraining] = await Promise.all([
    prisma.training.findUnique({ where: { id: trainingId } }),
    prisma.training.findUnique({ where: { id: parsedRequiredId } }),
  ]);

  if (!training) {
    return NextResponse.json({ error: 'Training not found' }, { status: 404 });
  }
  if (!requiredTraining) {
    return NextResponse.json({ error: 'Required training not found' }, { status: 404 });
  }

  // Check for cycle before adding
  if (await hasCycle(trainingId, parsedRequiredId)) {
    return NextResponse.json(
      { error: 'Adding this prerequisite would create a circular dependency' },
      { status: 400 }
    );
  }

  const prerequisite = await prisma.trainingTrainingRequirement.create({
    data: {
      trainingId,
      requiredTrainingId: parsedRequiredId,
    },
    include: {
      requiredTraining: {
        select: {
          id: true,
          name: true,
          category: { select: { name: true } },
        },
      },
    },
  });

  return NextResponse.json({ prerequisite });
}
