// app/admin/import/page.tsx
import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import LegacyImportClient from '@/app/admin/components/import/LegacyImportClient';

export default async function LegacyImportPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.isAdmin) {
    redirect('/');
  }

  return (
    <main className="min-h-screen">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="mb-6">
          <h1 className="text-3xl font-bold" style={{ color: 'var(--foreground)' }}>
            Legacy User Data Import
          </h1>
          <p className="mt-2 text-sm" style={{ color: 'var(--muted-foreground)' }}>
            Import legacy user ranks and attendance data from CSV file
          </p>
        </div>

        <LegacyImportClient />
      </div>
    </main>
  );
}
