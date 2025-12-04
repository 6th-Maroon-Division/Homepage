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
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold">Admin Panel</h1>
          <p className="text-sm sm:text-base text-gray-300 mt-2">
            Manage operations and system settings
          </p>
        </div>

        {/* Category Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Link
            href="/admin/orbats"
            className="bg-gray-800/50 border border-gray-700 rounded-lg p-8 hover:border-blue-500 hover:bg-gray-800 transition-colors"
          >
            <h2 className="text-2xl font-bold mb-2">OrbATs</h2>
            <p className="text-gray-400">Manage operations and battle tasks</p>
          </Link>
          
          <Link
            href="/admin/users"
            className="bg-gray-800/50 border border-gray-700 rounded-lg p-8 hover:border-blue-500 hover:bg-gray-800 transition-colors"
          >
            <h2 className="text-2xl font-bold mb-2">Users</h2>
            <p className="text-gray-400">Manage user accounts and permissions</p>
          </Link>
        </div>
      </div>
    </main>
  );
}
