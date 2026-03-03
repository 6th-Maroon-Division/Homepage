// app/admin/page.tsx
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { canAccessSubslotReadApi } from '@/lib/permission-api-logic';

export default async function AdminPage() {
  const session = await getServerSession(authOptions);
  const userPermissions = session?.user?.permissions || {};
  const hasSuperAdmin = (userPermissions['system:super_admin'] ?? 0) > 0;

  // Allow access if user has super-admin OR has any permissions (at least one with a positive value)
  const hasAnyPermissions =
    Object.values(userPermissions).some((value) => value > 0);
  if (!session || (!hasSuperAdmin && !hasAnyPermissions)) {
    redirect('/');
  }

  const canAccessSubslots = canAccessSubslotReadApi({
    hasSuperAdmin,
    canViewSubslot: (userPermissions['subslot:view'] ?? 0) > 0,
    canCreateSubslot: (userPermissions['subslot:create'] ?? 0) > 0,
    canEditSubslot: (userPermissions['subslot:edit'] ?? 0) > 0,
    canDeleteSubslot: (userPermissions['subslot:delete'] ?? 0) > 0,
    canCreateTemplate: (userPermissions['template:create'] ?? 0) > 0,
    canEditTemplate: (userPermissions['template:edit'] ?? 0) > 0,
    canDeleteTemplate: (userPermissions['template:delete'] ?? 0) > 0,
    canCreateOrbat: (userPermissions['orbat:create'] ?? 0) > 0,
    canEditOrbat: (userPermissions['orbat:edit'] ?? 0) > 0,
  });

  const canAccessOrbats = hasSuperAdmin;
  const canAccessTemplates =
    hasSuperAdmin ||
    (userPermissions['template:create'] ?? 0) > 0 ||
    (userPermissions['template:edit'] ?? 0) > 0 ||
    (userPermissions['template:delete'] ?? 0) > 0 ||
    (userPermissions['orbat:create'] ?? 0) > 0 ||
    (userPermissions['orbat:edit'] ?? 0) > 0;
  const canAccessUsers = hasSuperAdmin || (userPermissions['user:manage'] ?? 0) > 0;
  const canAccessRadioFrequencies = hasSuperAdmin || (userPermissions['orbat:edit'] ?? 0) > 0;
  const canAccessTrainings =
    hasSuperAdmin ||
    (userPermissions['training:create'] ?? 0) > 0 ||
    (userPermissions['training:edit'] ?? 0) > 0 ||
    (userPermissions['training:delete'] ?? 0) > 0;
  const canAccessAttendance =
    hasSuperAdmin ||
    (userPermissions['attendance:view'] ?? 0) > 0 ||
    (userPermissions['attendance:edit'] ?? 0) > 0;
  const canAccessRanks =
    hasSuperAdmin ||
    (userPermissions['rank:create'] ?? 0) > 0 ||
    (userPermissions['rank:edit'] ?? 0) > 0 ||
    (userPermissions['rank:delete'] ?? 0) > 0;
  const canAccessPromotions = hasSuperAdmin || (userPermissions['rank:manage_promotions'] ?? 0) > 0;
  const canAccessMessaging = hasSuperAdmin;

  return (
    <main className="min-h-screen">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {/* Category Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {canAccessOrbats && (
            <Link
              href="/admin/orbats"
              className="border rounded-lg p-8 transition-colors"
              style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)' }}
            >
              <h2 className="text-2xl font-bold mb-2" style={{ color: 'var(--foreground)' }}>OrbATs</h2>
              <p style={{ color: 'var(--muted-foreground)' }}>Manage operations and battle tasks</p>
            </Link>
          )}

          {canAccessSubslots && (
            <Link
              href="/admin/orbats/subslots"
              className="border rounded-lg p-8 transition-colors"
              style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)' }}
            >
              <h2 className="text-2xl font-bold mb-2" style={{ color: 'var(--foreground)' }}>Role Definitions</h2>
              <p style={{ color: 'var(--muted-foreground)' }}>Create and manage reusable ORBAT roles</p>
            </Link>
          )}
          
          {canAccessTemplates && (
            <Link
              href="/admin/templates"
              className="border rounded-lg p-8 transition-colors"
              style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)' }}
            >
              <h2 className="text-2xl font-bold mb-2" style={{ color: 'var(--foreground)' }}>Templates</h2>
              <p style={{ color: 'var(--muted-foreground)' }}>Create and manage ORBAT templates</p>
            </Link>
          )}

          {canAccessUsers && (
            <Link
              href="/admin/users"
              className="border rounded-lg p-8 transition-colors"
              style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)' }}
            >
              <h2 className="text-2xl font-bold mb-2" style={{ color: 'var(--foreground)' }}>Users</h2>
              <p style={{ color: 'var(--muted-foreground)' }}>Manage user accounts and permissions</p>
            </Link>
          )}

          {canAccessRadioFrequencies && (
            <Link
              href="/admin/radio-frequencies"
              className="border rounded-lg p-8 transition-colors"
              style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)' }}
            >
              <h2 className="text-2xl font-bold mb-2" style={{ color: 'var(--foreground)' }}>Radio Frequencies</h2>
              <p style={{ color: 'var(--muted-foreground)' }}>Manage radio frequencies for slots</p>
            </Link>
          )}

          {canAccessTrainings && (
            <Link
              href="/admin/trainings"
              className="border rounded-lg p-8 transition-colors"
              style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)' }}
            >
              <h2 className="text-2xl font-bold mb-2" style={{ color: 'var(--foreground)' }}>Trainings</h2>
              <p style={{ color: 'var(--muted-foreground)' }}>Create trainings and manage requests</p>
            </Link>
          )}

          {canAccessAttendance && (
            <Link
              href="/admin/attendance"
              className="border rounded-lg p-8 transition-colors"
              style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)' }}
            >
              <h2 className="text-2xl font-bold mb-2" style={{ color: 'var(--foreground)' }}>Attendance</h2>
              <p style={{ color: 'var(--muted-foreground)' }}>Track and manage operation attendance</p>
            </Link>
          )}

          {canAccessRanks && (
            <Link
              href="/admin/ranks"
              className="border rounded-lg p-8 transition-colors"
              style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)' }}
            >
              <h2 className="text-2xl font-bold mb-2" style={{ color: 'var(--foreground)' }}>Ranks</h2>
              <p style={{ color: 'var(--muted-foreground)' }}>Configure ranks and progression system</p>
            </Link>
          )}

          {canAccessPromotions && (
            <Link
              href="/admin/promotions"
              className="border rounded-lg p-8 transition-colors"
              style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)' }}
            >
              <h2 className="text-2xl font-bold mb-2" style={{ color: 'var(--foreground)' }}>Promotions</h2>
              <p style={{ color: 'var(--muted-foreground)' }}>Review pending rankups</p>
            </Link>
          )}

          {canAccessMessaging && (
            <Link
              href="/admin/messaging"
              className="border rounded-lg p-8 transition-colors"
              style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)' }}
            >
              <h2 className="text-2xl font-bold mb-2" style={{ color: 'var(--foreground)' }}>Messaging</h2>
              <p style={{ color: 'var(--muted-foreground)' }}>Send notifications to users</p>
            </Link>
          )}
        </div>
      </div>
    </main>
  );
}
