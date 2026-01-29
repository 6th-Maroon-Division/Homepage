import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { redirect } from 'next/navigation';
import PendingPromotionsClient from '@/app/admin/components/promotions/PendingPromotionsClient';

export default async function PendingPromotionsPage() {
  const session = await getServerSession(authOptions);

  if (!session || !session.user?.isAdmin) {
    redirect('/');
  }

  return (
    <main className="min-h-screen">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        <PendingPromotionsClient />
      </div>
    </main>
  );
}
