import { prisma } from '@/lib/prisma';

export const TRAINING_STAFF_PERMISSION_KEYS = [
  'training:approve_request',
  'training:mark',
  'system:super_admin',
] as const;

export async function isTrainingStaff(userId: number): Promise<boolean> {
  const permission = await prisma.userPermission.findFirst({
    where: {
      userId,
      value: { gt: 0 },
      permission: { key: { in: [...TRAINING_STAFF_PERMISSION_KEYS] } },
    },
    select: { id: true },
  });

  return Boolean(permission);
}

export async function getEligibleTrainingStaff() {
  return prisma.user.findMany({
    where: {
      userPermissions: {
        some: {
          value: { gt: 0 },
          permission: { key: { in: [...TRAINING_STAFF_PERMISSION_KEYS] } },
        },
      },
    },
    select: {
      id: true,
      username: true,
      avatarUrl: true,
    },
    orderBy: [{ username: 'asc' }, { id: 'asc' }],
  });
}

export async function assertEligibleTrainingStaff(userId: number): Promise<boolean> {
  return isTrainingStaff(userId);
}
