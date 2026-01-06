import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { redirect } from 'next/navigation';

export default async function ThemeManagementPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.isAdmin) {
    redirect('/');
  }

  return (
    <main className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-6">Theme Management</h1>
      <div className="p-6 rounded-lg border" style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)' }}>
        <p className="text-lg mb-2">Theme system has been removed.</p>
        <p style={{ color: 'var(--muted-foreground)' }}>
          The application now uses a static dark/light mode design based on system preferences.
        </p>
      </div>
    </main>
  );
}
