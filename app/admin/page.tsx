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
        <header className="space-y-2">
          <h1 className="text-2xl sm:text-3xl font-bold">Admin Panel</h1>
          <p className="text-sm sm:text-base" style={{ color: 'var(--muted-foreground)' }}>
            Manage operations and system settings
          </p>
        </header>

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

          <Link
            href="/admin/themes"
            className="border rounded-lg p-8 transition-colors"
            style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)' }}
          >
            <h2 className="text-2xl font-bold mb-2" style={{ color: 'var(--foreground)' }}>Themes</h2>
            <p style={{ color: 'var(--muted-foreground)' }}>Manage themes and review user submissions</p>
          </Link>
        </div>
      </div>
    </main>
  );
}
