import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { redirect } from 'next/navigation';
import RadioFrequenciesManagement from '@/app/admin/components/RadioFrequenciesManagement';

export default async function RadioFrequenciesPage() {
  const session = await getServerSession(authOptions);

  if (!session || !session.user?.isAdmin) {
    redirect('/');
  }

  return <RadioFrequenciesManagement />;
}
