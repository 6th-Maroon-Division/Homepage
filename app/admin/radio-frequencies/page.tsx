import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { redirect } from 'next/navigation';
import RadioFrequenciesManagement from '@/app/admin/components/RadioFrequenciesManagement';
import { checkPermission } from '@/lib/auth-middleware';

export default async function RadioFrequenciesPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    redirect('/');
  }
  
  // Check if user has orbat edit permission (radio frequencies are part of ORBATs)
  const hasPermission =
    (session.user.permissions?.['system:super_admin'] ?? 0) > 0 ||
    await checkPermission(session.user.id, 'orbat:edit');
  
  if (!hasPermission) {
    redirect('/admin');
  }

  return <RadioFrequenciesManagement />;
}
