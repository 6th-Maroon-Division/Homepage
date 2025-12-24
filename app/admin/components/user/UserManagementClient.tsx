'use client';

import { useState } from 'react';
import Image from 'next/image';
import ConfirmModal from '@/app/components/ui/ConfirmModal';
import { useToast } from '@/app/components/ui/ToastContainer';

type User = {
  id: number;
  username: string | null;
  email: string | null;
  avatarUrl: string | null;
  isAdmin: boolean;
  createdAt: string;
  providers: string[];
  signupCount: number;
  orbatCount: number;
};

type UserManagementClientProps = {
  users: User[];
  currentUserId: number;
};

export default function UserManagementClient({ users: initialUsers, currentUserId }: UserManagementClientProps) {
  const [users, setUsers] = useState<User[]>(initialUsers);
  const [filter, setFilter] = useState<'all' | 'admin' | 'regular'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [confirmAdmin, setConfirmAdmin] = useState<{ userId: number; currentIsAdmin: boolean; username: string | null } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ userId: number; username: string | null } | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const { showSuccess, showError } = useToast();

  const handleToggleAdmin = async (userId: number, currentIsAdmin: boolean) => {
    if (userId === currentUserId) {
      showError("You cannot modify your own admin status");
      return;
    }

    const user = users.find(u => u.id === userId);
    setConfirmAdmin({ userId, currentIsAdmin, username: user?.username || null });
  };

  const confirmToggleAdmin = async () => {
    if (!confirmAdmin) return;
    
    setIsLoading(true);
    const { userId, currentIsAdmin } = confirmAdmin;

    try {
      const res = await fetch(`/api/users/${userId}/admin`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ isAdmin: !currentIsAdmin }),
      });

      if (!res.ok) {
        const data = await res.json();
        showError(data.error || 'Failed to update user');
        return;
      }

      // Update local state
      setUsers(users.map(u => 
        u.id === userId ? { ...u, isAdmin: !currentIsAdmin } : u
      ));
      showSuccess(`User ${currentIsAdmin ? 'demoted from' : 'promoted to'} admin`);
    } catch (error) {
      console.error('Error updating user:', error);
      showError('Error updating user');
    } finally {
      setIsLoading(false);
      setConfirmAdmin(null);
    }
  };

  const handleDeleteUser = async (userId: number, username: string | null) => {
    if (userId === currentUserId) {
      showError("You cannot delete your own account");
      return;
    }

    setConfirmDelete({ userId, username });
  };

  const confirmDeleteUser = async () => {
    if (!confirmDelete) return;
    
    setIsLoading(true);
    const { userId } = confirmDelete;

    try {
      const res = await fetch(`/api/users/${userId}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        const data = await res.json();
        showError(data.error || 'Failed to delete user');
        return;
      }

      // Update local state
      setUsers(users.filter(u => u.id !== userId));
      showSuccess('User deleted successfully');
    } catch (error) {
      console.error('Error deleting user:', error);
      showError('Error deleting user');
    } finally {
      setIsLoading(false);
      setConfirmDelete(null);
    }
  };

  // Filter users
  const filteredUsers = users.filter(user => {
    // Apply role filter
    if (filter === 'admin' && !user.isAdmin) return false;
    if (filter === 'regular' && user.isAdmin) return false;

    // Apply search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      return (
        user.username?.toLowerCase().includes(query) ||
        user.email?.toLowerCase().includes(query)
      );
    }

    return true;
  });

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="flex gap-2">
          <button
            onClick={() => setFilter('all')}
            className="px-4 py-2 rounded-md font-medium transition-colors"
            style={{
              backgroundColor: filter === 'all' ? 'var(--primary)' : 'var(--secondary)',
              color: filter === 'all' ? 'var(--primary-foreground)' : 'var(--foreground)'
            }}
          >
            All Users ({users.length})
          </button>
          <button
            onClick={() => setFilter('admin')}
            className="px-4 py-2 rounded-md font-medium transition-colors"
            style={{
              backgroundColor: filter === 'admin' ? 'var(--primary)' : 'var(--secondary)',
              color: filter === 'admin' ? 'var(--primary-foreground)' : 'var(--foreground)'
            }}
          >
            Admins ({users.filter(u => u.isAdmin).length})
          </button>
          <button
            onClick={() => setFilter('regular')}
            className="px-4 py-2 rounded-md font-medium transition-colors"
            style={{
              backgroundColor: filter === 'regular' ? 'var(--primary)' : 'var(--secondary)',
              color: filter === 'regular' ? 'var(--primary-foreground)' : 'var(--foreground)'
            }}
          >
            Regular ({users.filter(u => !u.isAdmin).length})
          </button>
        </div>

        <input
          type="text"
          placeholder="Search users..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="flex-1 px-4 py-2 border rounded-md focus:outline-none focus:ring-2"
          style={{ 
            backgroundColor: 'var(--background)', 
            borderColor: 'var(--border)', 
            color: 'var(--foreground)'
          }}
        />
      </div>

      {/* Users Table */}
      <div className="border rounded-lg overflow-hidden" style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)' }}>
        {filteredUsers.length === 0 ? (
          <div className="px-6 py-12 text-center" style={{ color: 'var(--muted-foreground)' }}>
            <p>No users found</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead style={{ backgroundColor: 'var(--muted)' }}>
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--muted-foreground)' }}>
                    User
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--muted-foreground)' }}>
                    Email
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--muted-foreground)' }}>
                    Providers
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--muted-foreground)' }}>
                    Activity
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--muted-foreground)' }}>
                    Joined
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--muted-foreground)' }}>
                    Role
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--muted-foreground)' }}>
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody style={{ borderTopWidth: '1px', borderColor: 'var(--border)' }}>
                {filteredUsers.map((user) => (
                  <tr key={user.id} style={{ borderBottomWidth: '1px', borderColor: 'var(--border)' }}>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-3">
                        {user.avatarUrl && (
                          <Image
                            src={user.avatarUrl}
                            alt={user.username || 'User'}
                            width={32}
                            height={32}
                            className="rounded-full"
                          />
                        )}
                        <div>
                          <div className="font-medium" style={{ color: 'var(--foreground)' }}>
                            {user.username || 'Unknown'}
                          </div>
                          <div className="text-xs" style={{ color: 'var(--muted-foreground)' }}>ID: {user.id}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm" style={{ color: 'var(--foreground)' }}>
                      {user.email || '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      <div className="flex gap-1">
                        {user.providers.map((provider) => (
                          <span
                            key={provider}
                            className="px-2 py-1 rounded text-xs capitalize"
                            style={{ backgroundColor: 'var(--muted)', color: 'var(--foreground)' }}
                          >
                            {provider}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm" style={{ color: 'var(--foreground)' }}>
                      <div className="text-xs space-y-1">
                        <div>{user.signupCount} signups</div>
                        <div>{user.orbatCount} OrbATs</div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm" style={{ color: 'var(--foreground)' }}>
                      {new Date(user.createdAt).toLocaleDateString('en-GB')}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {user.isAdmin ? (
                        <span className="px-2 py-1 rounded text-xs font-medium" style={{ backgroundColor: 'var(--accent)', color: 'var(--accent-foreground)' }}>
                          Admin
                        </span>
                      ) : (
                        <span className="px-2 py-1 rounded text-xs" style={{ backgroundColor: 'var(--muted)', color: 'var(--foreground)' }}>
                          User
                        </span>
                      )}
                      {user.id === currentUserId && (
                        <span className="ml-2 text-xs" style={{ color: 'var(--primary)' }}>(You)</span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm space-x-2">
                      {user.id !== currentUserId && (
                        <>
                          <button
                            onClick={() => handleToggleAdmin(user.id, user.isAdmin)}
                            className={`font-medium ${
                              user.isAdmin
                                ? 'text-orange-400 hover:text-orange-300'
                                : 'text-green-400 hover:text-green-300'
                            }`}
                          >
                            {user.isAdmin ? 'Demote' : 'Promote'}
                          </button>
                          <span style={{ color: 'var(--border)' }}>|</span>
                          <button
                            onClick={() => handleDeleteUser(user.id, user.username)}
                            className="text-red-500 hover:text-red-400 font-medium"
                          >
                            Delete
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}      </div>

      {/* Confirm Modals */}
      <ConfirmModal
        isOpen={confirmAdmin !== null}
        title={confirmAdmin?.currentIsAdmin ? 'Demote Admin' : 'Promote to Admin'}
        message={`Are you sure you want to ${confirmAdmin?.currentIsAdmin ? 'demote' : 'promote'} ${confirmAdmin?.username || 'this user'} ${confirmAdmin?.currentIsAdmin ? 'from' : 'to'} admin?`}
        confirmLabel={confirmAdmin?.currentIsAdmin ? 'Demote' : 'Promote'}
        cancelLabel="Cancel"
        onConfirm={confirmToggleAdmin}
        onCancel={() => setConfirmAdmin(null)}
        isDestructive={confirmAdmin?.currentIsAdmin}
        isLoading={isLoading}
      />
      <ConfirmModal
        isOpen={confirmDelete !== null}
        title="Delete User"
        message={`Are you sure you want to delete the account for "${confirmDelete?.username || 'Unknown'}"? This will remove all their signups but keep their created OrbATs.`}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        onConfirm={confirmDeleteUser}
        onCancel={() => setConfirmDelete(null)}
        isDestructive={true}
        isLoading={isLoading}
      />
    </div>
  );
}
