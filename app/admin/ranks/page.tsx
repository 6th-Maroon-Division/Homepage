import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { redirect } from 'next/navigation';
import RankConfigClient from './RankConfigClient';
import { checkPermission } from '@/lib/auth-middleware';

export default async function RankConfigPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    redirect('/');
  }
  
  // Check if user has any rank permission
  const hasPermission = session.user.isAdmin || 
    await checkPermission(session.user.id, 'rank:create') ||
    await checkPermission(session.user.id, 'rank:edit') ||
    await checkPermission(session.user.id, 'rank:delete');
  
  if (!hasPermission) {
    redirect('/admin');
  }
  return (
    <main className="min-h-screen">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <RankConfigClient />
      </div>
    </main>
  );
}
