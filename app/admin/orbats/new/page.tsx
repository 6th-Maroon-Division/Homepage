// app/admin/orbats/new/page.tsx
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { redirect } from 'next/navigation';
import OrbatForm from '@/app/components/orbat/OrbatForm';
import { checkPermission } from '@/lib/auth-middleware';

export default async function NewOrbatPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    redirect('/');
  }
  
  // Check if user has ORBAT create permission
  const hasPermission =
    (session.user.permissions?.['system:super_admin'] ?? 0) > 0 ||
    await checkPermission(session.user.id, 'orbat:create');
  
  if (!hasPermission) {
    redirect('/admin');
  }

  return (
    <main className="min-h-screen">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        <OrbatForm mode="create" />
      </div>
    </main>
  );
}
