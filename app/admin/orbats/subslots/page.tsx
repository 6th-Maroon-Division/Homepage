import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import { checkPermission } from '@/lib/auth-middleware';
import SubslotDefinitionsManagementClient from '@/app/admin/components/orbat/SubslotDefinitionsManagementClient';
import { canAccessSubslotReadApi } from '@/lib/permission-api-logic';

export default async function AdminSubslotDefinitionsPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    redirect('/');
  }

  const [canViewSubslot, canCreateSubslot, canEditSubslot, canDeleteSubslot, canCreateTemplate, canEditTemplate, canDeleteTemplate, canCreateOrbat, canEditOrbat] = await Promise.all([
    checkPermission(session.user.id, 'subslot:view'),
    checkPermission(session.user.id, 'subslot:create'),
    checkPermission(session.user.id, 'subslot:edit'),
    checkPermission(session.user.id, 'subslot:delete'),
    checkPermission(session.user.id, 'template:create'),
    checkPermission(session.user.id, 'template:edit'),
    checkPermission(session.user.id, 'template:delete'),
    checkPermission(session.user.id, 'orbat:create'),
    checkPermission(session.user.id, 'orbat:edit'),
  ]);

  const canRead = canAccessSubslotReadApi({
    hasSuperAdmin: (session.user.permissions?.['system:super_admin'] ?? 0) > 0,
    canViewSubslot,
    canCreateSubslot,
    canEditSubslot,
    canDeleteSubslot,
    canCreateTemplate,
    canEditTemplate,
    canDeleteTemplate,
    canCreateOrbat,
    canEditOrbat,
  });

  if (!canRead) {
    redirect('/admin');
  }

  const canManage =
    (session.user.permissions?.['system:super_admin'] ?? 0) > 0 ||
    canCreateSubslot ||
    canEditSubslot ||
    canDeleteSubslot;

  const [definitions, trainings, ranks] = await Promise.all([
    prisma.squadRole.findMany({
      orderBy: { name: 'asc' },
    }),
    prisma.training.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
    prisma.rank.findMany({
      orderBy: { orderIndex: 'asc' },
      select: { id: true, name: true, abbreviation: true, orderIndex: true },
    }),
  ]);

  const trainingMap = new Map(trainings.map((training) => [training.id, training]));
  const rankMap = new Map(ranks.map((rank) => [rank.id, rank]));

  const hydratedDefinitions = definitions.map((definition) => {
    const requiredTrainings = (definition.requiredTrainingIds || [])
      .map((id) => trainingMap.get(id))
      .filter((item): item is { id: number; name: string } => Boolean(item));
    const requiredRanks = (definition.requiredRankIds || [])
      .map((id) => rankMap.get(id))
      .filter((item): item is { id: number; name: string; abbreviation: string; orderIndex: number } => Boolean(item));

    return {
      ...definition,
      requiredTrainingId: requiredTrainings[0]?.id ?? null,
      requiredRankId: requiredRanks[0]?.id ?? null,
      requiredTrainings,
      requiredRanks,
      requiredTraining: requiredTrainings[0] || null,
      requiredRank: requiredRanks[0] || null,
    };
  });

  return (
    <main className="min-h-screen">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <SubslotDefinitionsManagementClient
          initialDefinitions={hydratedDefinitions}
          trainings={trainings}
          ranks={ranks}
          isReadOnly={!canManage}
          canCreate={(session.user.permissions?.['system:super_admin'] ?? 0) > 0 || canCreateSubslot}
          canEdit={(session.user.permissions?.['system:super_admin'] ?? 0) > 0 || canEditSubslot}
          canDelete={(session.user.permissions?.['system:super_admin'] ?? 0) > 0 || canDeleteSubslot}
        />
      </div>
    </main>
  );
}
