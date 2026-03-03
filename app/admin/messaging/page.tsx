// app/admin/messaging/page.tsx
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { redirect } from 'next/navigation';
import MessagingDashboard from './MessagingDashboard';
import { checkPermission } from '@/lib/auth-middleware';

export default async function MessagingPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    redirect('/');
  }
  
  // Check if user has super admin permission (messaging requires high-level access)
  const hasPermission = await checkPermission(session.user.id, 'system:super_admin');
  
  if (!hasPermission) {
    redirect('/admin');
  }

  return (
    <main className="min-h-screen">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <MessagingDashboard />
      </div>
    </main>
  );
}
