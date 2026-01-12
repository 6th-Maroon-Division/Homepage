import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import TemplateManagementClient from '@/app/admin/components/templates/TemplateManagementClient';

export default async function AdminTemplatesPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.isAdmin) {
    redirect('/');
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
        <TemplateManagementClient templates={serializedTemplates} />
      </div>
    </main>
  );
}
