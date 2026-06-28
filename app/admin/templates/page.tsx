import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import TemplateManagementClient from '@/app/admin/components/templates/TemplateManagementClient';
import { checkPermission } from '@/lib/auth-middleware';

export default async function AdminTemplatesPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    redirect('/');
  }
  
  // Allow access to templates for template managers and ORBAT creators/editors.
  // ORBAT-only access is rendered in read-only mode.
  const [canEditTemplates, canCreateTemplates, canDeleteTemplates, canCreateOrbat, canEditOrbat] = await Promise.all([
    checkPermission(session.user.id, 'template:edit'),
    checkPermission(session.user.id, 'template:create'),
    checkPermission(session.user.id, 'template:delete'),
    checkPermission(session.user.id, 'orbat:create'),
    checkPermission(session.user.id, 'orbat:edit'),
  ]);
  const hasSuperAdmin = (session.user.permissions?.['system:super_admin'] ?? 0) > 0;
  const canManageTemplates = hasSuperAdmin || canEditTemplates || canCreateTemplates || canDeleteTemplates;
  const hasPermission = canManageTemplates || canCreateOrbat || canEditOrbat;
  const isReadOnly = !canManageTemplates && (canCreateOrbat || canEditOrbat);
  
  if (!hasPermission) {
    redirect('/admin');
  }

  const templates = await prisma.orbatTemplate.findMany({
    where: { isActive: true },
    include: {
      createdBy: {
        select: {
          id: true,
          username: true,
          avatarUrl: true,
        },
      },
    },
    orderBy: [{ updatedAt: 'desc' }],
  });

  // Serialize for client
  const serializedTemplates = templates.map((template) => ({
    id: template.id,
    name: template.name,
    description: template.description,
    category: template.category,
    tagsJson: template.tagsJson,
    usageCount: template.usageCount,
    isActive: template.isActive,
    createdBy: {
      id: template.createdBy.id,
      username: template.createdBy.username,
      avatarUrl: template.createdBy.avatarUrl,
    },
    createdAt: template.createdAt.toISOString(),
  }));

  return (
    <main className="min-h-screen">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        <TemplateManagementClient templates={serializedTemplates} isReadOnly={isReadOnly} />
      </div>
    </main>
  );
}
