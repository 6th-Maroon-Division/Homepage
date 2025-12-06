import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { redirect } from 'next/navigation';
import ThemeManagementClient from '../components/theme/ThemeManagementClient';

export default async function ThemeManagementPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.isAdmin) {
    redirect('/');
  }

  return <ThemeManagementClient />;
}
