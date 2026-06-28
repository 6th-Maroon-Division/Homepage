import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { redirect } from 'next/navigation';
import PendingPromotionsClient from '@/app/admin/components/promotions/PendingPromotionsClient';
import { checkPermission } from '@/lib/auth-middleware';

export default async function PendingPromotionsPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    redirect('/');
  }
  
  // Check if user has promotion management permission
  const hasPermission =
    (session.user.permissions?.['system:super_admin'] ?? 0) > 0 ||
    await checkPermission(session.user.id, 'rank:manage_promotions');
  
  if (!hasPermission) {
    redirect('/admin');
  }

  return (
    <main className="min-h-screen">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        <PendingPromotionsClient />
      </div>
    </main>
  );
}
