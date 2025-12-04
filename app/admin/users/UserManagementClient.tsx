'use client';

import { useState } from 'react';
import Image from 'next/image';

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

  const handleToggleAdmin = async (userId: number, currentIsAdmin: boolean) => {
    if (userId === currentUserId) {
      alert("You cannot modify your own admin status");
      return;
    }

    const action = currentIsAdmin ? 'demote' : 'promote';
    if (!confirm(`Are you sure you want to ${action} this user ${currentIsAdmin ? 'from' : 'to'} admin?`)) {
      return;
    }

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
        alert(data.error || 'Failed to update user');
        return;
      }

      // Update local state
      setUsers(users.map(u => 
        u.id === userId ? { ...u, isAdmin: !currentIsAdmin } : u
      ));
    } catch (error) {
      console.error('Error updating user:', error);
      alert('Error updating user');
    }
  };

  const handleDeleteUser = async (userId: number, username: string | null) => {
    if (userId === currentUserId) {
      alert("You cannot delete your own account");
      return;
    }

    if (!confirm(`Are you sure you want to delete the account for "${username || 'Unknown'}"? This will remove all their signups but keep their created OrbATs.`)) {
      return;
    }

    try {
      const res = await fetch(`/api/users/${userId}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        const data = await res.json();
        alert(data.error || 'Failed to delete user');
        return;
      }

      // Update local state
      setUsers(users.filter(u => u.id !== userId));
    } catch (error) {
      console.error('Error deleting user:', error);
      alert('Error deleting user');
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
            className={`px-4 py-2 rounded-md font-medium transition-colors ${
              filter === 'all'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            All Users ({users.length})
          </button>
          <button
            onClick={() => setFilter('admin')}
            className={`px-4 py-2 rounded-md font-medium transition-colors ${
              filter === 'admin'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            Admins ({users.filter(u => u.isAdmin).length})
          </button>
          <button
            onClick={() => setFilter('regular')}
            className={`px-4 py-2 rounded-md font-medium transition-colors ${
              filter === 'regular'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            Regular ({users.filter(u => !u.isAdmin).length})
          </button>
        </div>

        <input
          type="text"
          placeholder="Search users..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="flex-1 px-4 py-2 bg-gray-900/50 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Users Table */}
      <div className="bg-gray-800/50 border border-gray-700 rounded-lg overflow-hidden">
        {filteredUsers.length === 0 ? (
          <div className="px-6 py-12 text-center text-gray-400">
            <p>No users found</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-700/50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                    User
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                    Email
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                    Providers
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                    Activity
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                    Joined
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                    Role
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700">
                {filteredUsers.map((user) => (
                  <tr key={user.id} className="hover:bg-gray-700/30">
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
                          <div className="font-medium text-white">
                            {user.username || 'Unknown'}
                          </div>
                          <div className="text-xs text-gray-400">ID: {user.id}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">
                      {user.email || '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      <div className="flex gap-1">
                        {user.providers.map((provider) => (
                          <span
                            key={provider}
                            className="px-2 py-1 bg-gray-700 rounded text-xs capitalize"
                          >
                            {provider}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">
                      <div className="text-xs space-y-1">
                        <div>{user.signupCount} signups</div>
                        <div>{user.orbatCount} OrbATs</div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">
                      {new Date(user.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {user.isAdmin ? (
                        <span className="px-2 py-1 bg-purple-600 text-white rounded text-xs font-medium">
                          Admin
                        </span>
                      ) : (
                        <span className="px-2 py-1 bg-gray-700 text-gray-300 rounded text-xs">
                          User
                        </span>
                      )}
                      {user.id === currentUserId && (
                        <span className="ml-2 text-xs text-blue-400">(You)</span>
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
                          <span className="text-gray-600">|</span>
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
        )}
      </div>
    </div>
  );
}
