'use client';

import { useState, useEffect } from 'react';
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
  trainingCount: number;
  trainings: Array<{
    id: number;
    trainingId: number;
    trainingName: string;
    needsRetraining: boolean;
    isHidden: boolean;
    notes: string | null;
    completedAt: string;
    assignedAt: string;
  }>;
};

type UserManagementClientProps = {
  users: User[];
  currentUserId: number;
};

export default function UserManagementClient({ users: initialUsers, currentUserId }: UserManagementClientProps) {
  const [users, setUsers] = useState<User[]>(initialUsers);
  const [activeTab, setActiveTab] = useState<'all' | 'unranked'>('all');
  const [filter, setFilter] = useState<'all' | 'admin' | 'regular'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [confirmAdmin, setConfirmAdmin] = useState<{ userId: number; currentIsAdmin: boolean; username: string | null } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ userId: number; username: string | null } | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [expandedUserId, setExpandedUserId] = useState<number | null>(null);
  const [trainingModalData, setTrainingModalData] = useState<{ userId: number; trainingId: string; notes: string; needsRetraining: boolean; isHidden: boolean } | null>(null);
  const [availableTrainings, setAvailableTrainings] = useState<Array<{ id: number; name: string; category: string | null; duration: number | null }>>([]);
  const [loadingTrainings, setLoadingTrainings] = useState(false);
  
  // Unranked users state
  const [unrankedUsers, setUnrankedUsers] = useState<any[]>([]);
  const [unrankedLoading, setUnrankedLoading] = useState(false);
  const [unrankedFilter, setUnrankedFilter] = useState<'all' | 'needsInterview' | 'needsBCT' | 'retired'>('all');
  const [selectedUnranked, setSelectedUnranked] = useState<Set<number>>(new Set());
  const [ranks, setRanks] = useState<Array<{ id: number; name: string; abbreviation: string }>>([]);
  
  const { showSuccess, showError } = useToast();

  // Fetch unranked users
  const fetchUnrankedUsers = async () => {
    setUnrankedLoading(true);
    try {
      let interview = 'all';
      let bct = 'all';
      let retired = 'all';
      
      if (unrankedFilter === 'needsInterview') {
        interview = 'notDone';
      } else if (unrankedFilter === 'needsBCT') {
        bct = 'notDone';
      } else if (unrankedFilter === 'retired') {
        retired = 'retired';
      }
      
      const res = await fetch(
        `/api/admin/users/unranked?interview=${interview}&bct=${bct}&retired=${retired}`
      );
      const data = await res.json();
      setUnrankedUsers(data.users || []);
    } catch (e) {
      showError('Failed to load unranked users');
    } finally {
      setUnrankedLoading(false);
    }
  };

  // Fetch ranks for bulk assignment
  const fetchRanks = async () => {
    try {
      const res = await fetch('/api/ranks');
      const data = await res.json();
      setRanks(data.ranks || []);
    } catch (e) {
      console.error(e);
    }
  };

  // Load unranked users when tab switches or filter changes
  useEffect(() => {
    if (activeTab === 'unranked') {
      // Debounce to prevent spam
      const timer = setTimeout(() => {
        fetchUnrankedUsers();
        if (ranks.length === 0) {
          fetchRanks();
        }
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [activeTab, unrankedFilter]);

  // Reload when filters change
  const handleUnrankedFilterChange = (filter: 'all' | 'needsInterview' | 'needsBCT' | 'retired') => {
    setUnrankedFilter(filter);
  };

  // Bulk actions for unranked users
  const bulkAssignRank = async (rankId: number) => {
    try {
      const res = await fetch('/api/admin/users/bulk-rank-assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userIds: Array.from(selectedUnranked), rankId }),
      });
      if (!res.ok) throw new Error('Failed');
      showSuccess(`Assigned rank to ${selectedUnranked.size} users`);
      setSelectedUnranked(new Set());
      fetchUnrankedUsers();
    } catch (e) {
      showError('Failed to assign ranks');
    }
  };

  const bulkToggleInterview = async () => {
    try {
      const res = await fetch('/api/admin/users/bulk-interview-toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userIds: Array.from(selectedUnranked) }),
      });
      if (!res.ok) throw new Error('Failed');
      showSuccess(`Toggled interview for ${selectedUnranked.size} users`);
      setSelectedUnranked(new Set());
      fetchUnrankedUsers();
    } catch (e) {
      showError('Failed to toggle interview');
    }
  };

  const bulkToggleRetired = async () => {
    try {
      const res = await fetch('/api/admin/users/bulk-retire-toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userIds: Array.from(selectedUnranked) }),
      });
      if (!res.ok) throw new Error('Failed');
      showSuccess(`Toggled retired for ${selectedUnranked.size} users`);
      setSelectedUnranked(new Set());
      fetchUnrankedUsers();
    } catch (e) {
      showError('Failed to toggle retired');
    }
  };

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

  const handleAssignTraining = async (userId: number, trainingId: string, notes: string, needsRetraining: boolean, isHidden: boolean) => {
    if (!trainingId) {
      showError('Please select a training');
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch('/api/user-trainings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          trainingId: parseInt(trainingId),
          notes: notes || null,
          needsRetraining,
          isHidden,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        showError(data.error || 'Failed to assign training');
        return;
      }

      // Update user trainings
      const updatedUsers = users.map(u => {
        if (u.id === userId) {
          // Fetch updated training data
          return u;
        }
        return u;
      });
      
      // Re-fetch to get the updated trainings
      const updatedRes = await fetch(`/api/users/${userId}`);
      if (updatedRes.ok) {
        const updatedUser = await updatedRes.json();
        setUsers(users.map(u => u.id === userId ? updatedUser : u));
      }

      showSuccess('Training assigned successfully');
      setTrainingModalData(null);
    } catch (error) {
      console.error('Error assigning training:', error);
      showError('Error assigning training');
    } finally {
      setIsLoading(false);
    }
  };

  const fetchAvailableTrainings = async () => {
    if (availableTrainings.length > 0) return; // Already fetched
    setLoadingTrainings(true);
    try {
      const res = await fetch('/api/trainings/available');
      if (res.ok) {
        const data = await res.json();
        setAvailableTrainings(data);
      }
    } catch (error) {
      console.error('Error fetching trainings:', error);
    } finally {
      setLoadingTrainings(false);
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
    <div>
      {/* Tabs */}
      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setActiveTab('all')}
          className="px-6 py-3 rounded-lg font-medium transition-colors"
          style={{
            backgroundColor: activeTab === 'all' ? 'var(--primary)' : 'var(--secondary)',
            color: activeTab === 'all' ? 'var(--primary-foreground)' : 'var(--foreground)',
            borderWidth: '1px',
            borderColor: activeTab === 'all' ? 'var(--primary)' : 'var(--border)'
          }}
        >
          All Users
        </button>
        <button
          onClick={() => setActiveTab('unranked')}
          className="px-6 py-3 rounded-lg font-medium transition-colors"
          style={{
            backgroundColor: activeTab === 'unranked' ? 'var(--primary)' : 'var(--secondary)',
            color: activeTab === 'unranked' ? 'var(--primary-foreground)' : 'var(--foreground)',
            borderWidth: '1px',
            borderColor: activeTab === 'unranked' ? 'var(--primary)' : 'var(--border)'
          }}
        >
          Unranked Users
        </button>
      </div>

      {/* All Users Tab */}
      {activeTab === 'all' && (
      <div className="border rounded-lg overflow-hidden" style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)' }}>
        <div className="px-6 py-4" style={{ borderBottomWidth: '1px', borderColor: 'var(--border)' }}>
          <h2 className="text-xl font-semibold" style={{ color: 'var(--foreground)' }}>User Management</h2>
          <p className="text-sm mt-1" style={{ color: 'var(--muted-foreground)' }}>
            Manage user accounts, roles, and permissions
          </p>
        </div>

        {/* Filters */}
        <div className="px-6 py-4 flex flex-col sm:flex-row gap-4" style={{ borderBottomWidth: '1px', borderColor: 'var(--border)' }}>
          <div className="flex gap-2">
            <button
              onClick={() => setFilter('all')}
              className="px-4 py-2 rounded-md font-medium transition-colors"
              style={{
                backgroundColor: filter === 'all' ? 'var(--primary)' : 'var(--muted)',
                color: filter === 'all' ? 'var(--primary-foreground)' : 'var(--foreground)'
              }}
            >
              All Users ({users.length})
            </button>
            <button
              onClick={() => setFilter('admin')}
              className="px-4 py-2 rounded-md font-medium transition-colors"
              style={{
                backgroundColor: filter === 'admin' ? 'var(--primary)' : 'var(--muted)',
                color: filter === 'admin' ? 'var(--primary-foreground)' : 'var(--foreground)'
              }}
            >
              Admins ({users.filter(u => u.isAdmin).length})
            </button>
            <button
              onClick={() => setFilter('regular')}
              className="px-4 py-2 rounded-md font-medium transition-colors"
              style={{
                backgroundColor: filter === 'regular' ? 'var(--primary)' : 'var(--muted)',
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
                  <>
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
                      <button
                        onClick={() => setExpandedUserId(expandedUserId === user.id ? null : user.id)}
                        className="text-blue-400 hover:text-blue-300 font-medium"
                      >
                        {expandedUserId === user.id ? 'Hide' : 'View'} Trainings
                      </button>
                      {user.id !== currentUserId && (
                        <>
                          <span style={{ color: 'var(--border)' }}>|</span>
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
                  {expandedUserId === user.id && (
                    <tr style={{ backgroundColor: 'rgba(0,0,0,0.1)', borderBottomWidth: '1px', borderColor: 'var(--border)' }}>
                      <td colSpan={7} className="px-6 py-4">
                        <div className="space-y-4">
                          <h4 className="font-semibold text-sm" style={{ color: 'var(--foreground)' }}>
                            Trainings ({user.trainingCount})
                          </h4>
                          {user.trainings.length > 0 ? (
                            <div className="space-y-2">
                              {user.trainings.map((training) => (
                                <div
                                  key={training.id}
                                  className="p-3 rounded border"
                                  style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)' }}
                                >
                                  <div className="flex justify-between items-start">
                                    <div className="flex-1">
                                      <h5 className="font-medium" style={{ color: 'var(--foreground)' }}>
                                        {training.trainingName}
                                      </h5>
                                      <div className="flex gap-2 mt-1 text-xs">
                                        {training.needsRetraining && (
                                          <span
                                            className="px-2 py-1 rounded"
                                            style={{ backgroundColor: 'var(--accent)', color: 'var(--accent-foreground)' }}
                                          >
                                            Retraining Required
                                          </span>
                                        )}
                                        {training.isHidden && (
                                          <span
                                            className="px-2 py-1 rounded"
                                            style={{ backgroundColor: 'var(--muted)', color: 'var(--muted-foreground)' }}
                                          >
                                            Hidden from User
                                          </span>
                                        )}
                                      </div>
                                      {training.notes && (
                                        <p className="text-xs mt-2" style={{ color: 'var(--muted-foreground)' }}>
                                          Notes: {training.notes}
                                        </p>
                                      )}
                                      <p className="text-xs mt-1" style={{ color: 'var(--muted-foreground)' }}>
                                        Completed: {new Date(training.completedAt).toLocaleDateString('en-GB')}
                                      </p>
                                    </div>
                                    <div className="flex gap-2 ml-2">
                                      <button
                                        onClick={() => {
                                          const updatedTraining = { ...training };
                                          setTrainingModalData({
                                            userId: user.id,
                                            trainingId: training.trainingId.toString(),
                                            notes: training.notes || '',
                                            needsRetraining: training.needsRetraining,
                                            isHidden: training.isHidden,
                                          });
                                        }}
                                        className="px-2 py-1 text-xs rounded"
                                        style={{
                                          backgroundColor: 'var(--primary)',
                                          color: 'var(--primary-foreground)',
                                        }}
                                      >
                                        Edit
                                      </button>
                                      <button
                                        onClick={async () => {
                                          if (!confirm('Remove this training from the user?')) return;
                                          setIsLoading(true);
                                          try {
                                            const res = await fetch(`/api/user-trainings/${training.id}`, {
                                              method: 'DELETE',
                                            });
                                            if (res.ok) {
                                              setUsers(users.map(u => 
                                                u.id === user.id 
                                                  ? { ...u, trainings: u.trainings.filter(t => t.id !== training.id), trainingCount: u.trainingCount - 1 }
                                                  : u
                                              ));
                                              showSuccess('Training removed');
                                            } else {
                                              showError('Failed to remove training');
                                            }
                                          } catch (error) {
                                            console.error('Error:', error);
                                            showError('Error removing training');
                                          } finally {
                                            setIsLoading(false);
                                          }
                                        }}
                                        disabled={isLoading}
                                        className="px-2 py-1 text-xs rounded"
                                        style={{
                                          backgroundColor: 'var(--destructive)',
                                          color: 'var(--destructive-foreground)',
                                        }}
                                      >
                                        Remove
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>
                              No trainings assigned
                            </p>
                          )}

                          {/* Assign New Training Form */}
                          <div
                            className="p-4 rounded border mt-4"
                            style={{ backgroundColor: 'var(--muted)', borderColor: 'var(--border)' }}
                          >
                            <h5 className="font-medium text-sm mb-3" style={{ color: 'var(--foreground)' }}>
                              Assign New Training
                            </h5>
                            <form
                              onSubmit={async (e) => {
                                e.preventDefault();
                                const formData = new FormData(e.currentTarget);
                                const trainingId = formData.get('trainingId');
                                const notes = formData.get('notes');
                                const needsRetraining = formData.get('needsRetraining') === 'on';
                                const isHidden = formData.get('isHidden') === 'on';

                                if (!trainingId) {
                                  showError('Please select a training');
                                  return;
                                }

                                setIsLoading(true);
                                try {
                                  const res = await fetch('/api/user-trainings', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({
                                      userId: user.id,
                                      trainingId: parseInt(trainingId as string),
                                      notes: notes || null,
                                      needsRetraining,
                                      isHidden,
                                    }),
                                  });

                                  if (res.ok) {
                                    showSuccess('Training assigned successfully');
                                    (e.target as HTMLFormElement).reset();
                                    // Reload the page to show updated data
                                    window.location.reload();
                                  } else {
                                    const data = await res.json();
                                    showError(data.error || 'Failed to assign training');
                                  }
                                } catch (error) {
                                  console.error('Error assigning training:', error);
                                  showError('Error assigning training');
                                } finally {
                                  setIsLoading(false);
                                }
                              }}
                              className="space-y-3"
                            >
                              <div>
                                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--foreground)' }}>
                                  Training *
                                </label>
                                <select
                                  name="trainingId"
                                  onFocus={fetchAvailableTrainings}
                                  className="w-full px-3 py-2 rounded border text-sm"
                                  style={{
                                    backgroundColor: 'var(--background)',
                                    borderColor: 'var(--border)',
                                    color: 'var(--foreground)',
                                  }}
                                  required
                                >
                                  <option value="">{loadingTrainings ? 'Loading...' : 'Select training'}</option>
                                  {availableTrainings.map((training) => (
                                    <option key={training.id} value={training.id}>
                                      {training.name} {training.category ? `(${training.category})` : ''}
                                    </option>
                                  ))}
                                </select>
                              </div>

                              <div>
                                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--foreground)' }}>
                                  Notes
                                </label>
                                <textarea
                                  name="notes"
                                  rows={2}
                                  className="w-full px-3 py-2 rounded border text-sm"
                                  style={{
                                    backgroundColor: 'var(--background)',
                                    borderColor: 'var(--border)',
                                    color: 'var(--foreground)',
                                  }}
                                />
                              </div>

                              <div className="flex items-center gap-2">
                                <input
                                  type="checkbox"
                                  name="needsRetraining"
                                  id={`needsRetrain-${user.id}`}
                                  className="w-4 h-4"
                                />
                                <label htmlFor={`needsRetrain-${user.id}`} className="text-xs" style={{ color: 'var(--foreground)' }}>
                                  Needs retraining
                                </label>
                              </div>

                              <div className="flex items-center gap-2">
                                <input
                                  type="checkbox"
                                  name="isHidden"
                                  id={`isHidden-${user.id}`}
                                  className="w-4 h-4"
                                />
                                <label htmlFor={`isHidden-${user.id}`} className="text-xs" style={{ color: 'var(--foreground)' }}>
                                  Hide from user
                                </label>
                              </div>

                              <button
                                type="submit"
                                disabled={isLoading || loadingTrainings}
                                className="w-full px-3 py-2 rounded font-medium text-sm transition-colors disabled:opacity-50"
                                style={{
                                  backgroundColor: 'var(--primary)',
                                  color: 'var(--primary-foreground)',
                                }}
                              >
                                {isLoading ? 'Assigning...' : 'Assign Training'}
                              </button>
                            </form>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      )}

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

      {/* Edit User Training Modal */}
      {trainingModalData && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50"
          onClick={() => setTrainingModalData(null)}
        >
          <div
            className="bg-white rounded-lg shadow-lg max-w-md w-full p-6"
            style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-xl font-bold mb-4" style={{ color: 'var(--foreground)' }}>
              Edit Training Assignment
            </h2>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2" style={{ color: 'var(--foreground)' }}>
                  Notes
                </label>
                <textarea
                  value={trainingModalData.notes}
                  onChange={(e) =>
                    setTrainingModalData({
                      ...trainingModalData,
                      notes: e.target.value,
                    })
                  }
                  rows={3}
                  className="w-full px-3 py-2 rounded border"
                  style={{
                    backgroundColor: 'var(--background)',
                    borderColor: 'var(--border)',
                    color: 'var(--foreground)',
                  }}
                  placeholder="Add notes about this training..."
                />
              </div>

              <div className="space-y-2">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={trainingModalData.needsRetraining}
                    onChange={(e) =>
                      setTrainingModalData({
                        ...trainingModalData,
                        needsRetraining: e.target.checked,
                      })
                    }
                    className="w-4 h-4"
                  />
                  <span className="text-sm" style={{ color: 'var(--foreground)' }}>
                    Needs Retraining
                  </span>
                </label>

                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={trainingModalData.isHidden}
                    onChange={(e) =>
                      setTrainingModalData({
                        ...trainingModalData,
                        isHidden: e.target.checked,
                      })
                    }
                    className="w-4 h-4"
                  />
                  <span className="text-sm" style={{ color: 'var(--foreground)' }}>
                    Hidden
                  </span>
                </label>
              </div>

              <div className="flex gap-2 pt-4">
                <button
                  onClick={async () => {
                    setIsLoading(true);
                    try {
                      const res = await fetch(
                        `/api/user-trainings/${
                          users
                            .find((u) => u.id === trainingModalData.userId)
                            ?.trainings.find((t) => t.trainingId === parseInt(trainingModalData.trainingId))?.id
                        }`,
                        {
                          method: 'PUT',
                          headers: {
                            'Content-Type': 'application/json',
                          },
                          body: JSON.stringify({
                            notes: trainingModalData.notes || null,
                            needsRetraining: trainingModalData.needsRetraining,
                            isHidden: trainingModalData.isHidden,
                          }),
                        }
                      );

                      if (res.ok) {
                        const updatedTraining = await res.json();
                        setUsers(
                          users.map((u) =>
                            u.id === trainingModalData.userId
                              ? {
                                  ...u,
                                  trainings: u.trainings.map((t) =>
                                    t.trainingId === parseInt(trainingModalData.trainingId)
                                      ? {
                                          ...t,
                                          notes: trainingModalData.notes || null,
                                          needsRetraining: trainingModalData.needsRetraining,
                                          isHidden: trainingModalData.isHidden,
                                        }
                                      : t
                                  ),
                                }
                              : u
                          )
                        );
                        showSuccess('Training updated successfully');
                        setTrainingModalData(null);
                      } else {
                        showError('Failed to update training');
                      }
                    } catch (error) {
                      console.error('Error:', error);
                      showError('Error updating training');
                    } finally {
                      setIsLoading(false);
                    }
                  }}
                  disabled={isLoading}
                  className="flex-1 px-4 py-2 rounded font-medium transition-colors disabled:opacity-50"
                  style={{
                    backgroundColor: 'var(--primary)',
                    color: 'var(--primary-foreground)',
                  }}
                >
                  Save
                </button>

                <button
                  onClick={() => setTrainingModalData(null)}
                  disabled={isLoading}
                  className="flex-1 px-4 py-2 rounded font-medium transition-colors disabled:opacity-50"
                  style={{
                    backgroundColor: 'var(--secondary)',
                    color: 'var(--foreground)',
                    border: '1px solid var(--border)',
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Unranked Users Tab */}
      {activeTab === 'unranked' && (
        <div className="border rounded-lg overflow-hidden" style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)' }}>
          <div className="px-6 py-4" style={{ borderBottomWidth: '1px', borderColor: 'var(--border)' }}>
            <h2 className="text-xl font-semibold" style={{ color: 'var(--foreground)' }}>Unranked Users</h2>
            <p className="text-sm mt-1" style={{ color: 'var(--muted-foreground)' }}>
              Onboard and manage unranked personnel
            </p>
          </div>

          {/* Filters */}
          <div className="px-6 py-4 flex gap-2" style={{ borderBottomWidth: '1px', borderColor: 'var(--border)' }}>
            <button
              onClick={() => handleUnrankedFilterChange('all')}
              className="px-4 py-2 rounded-md font-medium transition-colors"
              style={{
                backgroundColor: unrankedFilter === 'all' ? 'var(--primary)' : 'var(--muted)',
                color: unrankedFilter === 'all' ? 'var(--primary-foreground)' : 'var(--foreground)'
              }}
            >
              All Unranked ({unrankedUsers.length})
            </button>
            <button
              onClick={() => handleUnrankedFilterChange('needsInterview')}
              className="px-4 py-2 rounded-md font-medium transition-colors"
              style={{
                backgroundColor: unrankedFilter === 'needsInterview' ? 'var(--primary)' : 'var(--muted)',
                color: unrankedFilter === 'needsInterview' ? 'var(--primary-foreground)' : 'var(--foreground)'
              }}
            >
              Needs Interview
            </button>
            <button
              onClick={() => handleUnrankedFilterChange('needsBCT')}
              className="px-4 py-2 rounded-md font-medium transition-colors"
              style={{
                backgroundColor: unrankedFilter === 'needsBCT' ? 'var(--primary)' : 'var(--muted)',
                color: unrankedFilter === 'needsBCT' ? 'var(--primary-foreground)' : 'var(--foreground)'
              }}
            >
              Needs BCT
            </button>
            <button
              onClick={() => handleUnrankedFilterChange('retired')}
              className="px-4 py-2 rounded-md font-medium transition-colors"
              style={{
                backgroundColor: unrankedFilter === 'retired' ? 'var(--primary)' : 'var(--muted)',
                color: unrankedFilter === 'retired' ? 'var(--primary-foreground)' : 'var(--foreground)'
              }}
            >
              Retired
            </button>
          </div>

          {/* Bulk Actions */}
          {selectedUnranked.size > 0 && (
            <div className="px-6 py-3 flex gap-2 flex-wrap" style={{ backgroundColor: 'var(--muted)', borderBottomWidth: '1px', borderColor: 'var(--border)' }}>
              <span className="text-sm font-medium py-2" style={{ color: 'var(--foreground)' }}>
                {selectedUnranked.size} selected:
              </span>
              {ranks.map((rank) => (
                <button
                  key={rank.id}
                  className="px-3 py-1 rounded-md text-sm font-medium"
                  style={{ backgroundColor: 'var(--primary)', color: 'var(--primary-foreground)' }}
                  onClick={() => bulkAssignRank(rank.id)}
                >
                  → {rank.abbreviation}
                </button>
              ))}
              <button
                className="px-3 py-1 rounded-md text-sm font-medium"
                style={{ backgroundColor: 'var(--accent)', color: 'white' }}
                onClick={bulkToggleInterview}
              >
                Toggle Interview
              </button>
              <button
                className="px-3 py-1 rounded-md text-sm font-medium"
                style={{ backgroundColor: 'var(--accent)', color: 'white' }}
                onClick={bulkToggleRetired}
              >
                Toggle Retired
              </button>
            </div>
          )}

          {/* Users Table */}
          {unrankedLoading ? (
            <div className="px-6 py-12 text-center" style={{ color: 'var(--muted-foreground)' }}>
              <p>Loading...</p>
            </div>
          ) : unrankedUsers.length === 0 ? (
            <div className="px-6 py-12 text-center" style={{ color: 'var(--muted-foreground)' }}>
              <p>No unranked users found</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead style={{ backgroundColor: 'var(--muted)' }}>
                  <tr>
                    <th className="px-6 py-3 text-left">
                      <input
                        type="checkbox"
                        checked={selectedUnranked.size === unrankedUsers.length && unrankedUsers.length > 0}
                        onChange={() => {
                          if (selectedUnranked.size === unrankedUsers.length) {
                            setSelectedUnranked(new Set());
                          } else {
                            setSelectedUnranked(new Set(unrankedUsers.map((u) => u.id)));
                          }
                        }}
                      />
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--muted-foreground)' }}>
                      Username
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--muted-foreground)' }}>
                      Interview
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--muted-foreground)' }}>
                      BCT
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--muted-foreground)' }}>
                      Retired
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--muted-foreground)' }}>
                      Attendance
                    </th>
                  </tr>
                </thead>
                <tbody style={{ backgroundColor: 'var(--secondary)' }}>
                  {unrankedUsers.map((user) => (
                    <tr key={user.id} style={{ borderTopWidth: '1px', borderColor: 'var(--border)' }}>
                      <td className="px-6 py-4">
                        <input
                          type="checkbox"
                          checked={selectedUnranked.has(user.id)}
                          onChange={() => {
                            const newSelected = new Set(selectedUnranked);
                            if (newSelected.has(user.id)) {
                              newSelected.delete(user.id);
                            } else {
                              newSelected.add(user.id);
                            }
                            setSelectedUnranked(newSelected);
                          }}
                        />
                      </td>
                      <td className="px-6 py-4" style={{ color: 'var(--foreground)' }}>
                        {user.username}
                      </td>
                      <td className="px-6 py-4" style={{ color: 'var(--foreground)' }}>
                        <span className={user.userRank?.interviewDone ? 'text-green-500' : 'text-red-500'}>
                          {user.userRank?.interviewDone ? '✓' : '✗'}
                        </span>
                      </td>
                      <td className="px-6 py-4" style={{ color: 'var(--foreground)' }}>
                        <span className={user.bctCompleted ? 'text-green-500' : 'text-red-500'}>
                          {user.bctCompleted ? '✓' : '✗'}
                        </span>
                      </td>
                      <td className="px-6 py-4" style={{ color: 'var(--foreground)' }}>
                        {user.userRank?.retired ? 'Yes' : 'No'}
                      </td>
                      <td className="px-6 py-4" style={{ color: 'var(--foreground)' }}>
                        {user.attendanceTotal}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
