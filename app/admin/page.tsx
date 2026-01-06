// app/admin/page.tsx
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { redirect } from 'next/navigation';
import Link from 'next/link';

export default async function AdminPage() {
  const session = await getServerSession(authOptions);

  if (!session || !session.user?.isAdmin) {
    redirect('/');
  }

  return (
    <main className="min-h-screen">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {/* Category Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Link
            href="/admin/orbats"
            className="border rounded-lg p-8 transition-colors"
            style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)' }}
          >
            <h2 className="text-2xl font-bold mb-2" style={{ color: 'var(--foreground)' }}>OrbATs</h2>
            <p style={{ color: 'var(--muted-foreground)' }}>Manage operations and battle tasks</p>
          </Link>
          
          <Link
            href="/admin/users"
            className="border rounded-lg p-8 transition-colors"
            style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)' }}
          >
            <h2 className="text-2xl font-bold mb-2" style={{ color: 'var(--foreground)' }}>Users</h2>
            <p style={{ color: 'var(--muted-foreground)' }}>Manage user accounts and permissions</p>
          </Link>
        </div>
      </div>
    </main>
  );
}
