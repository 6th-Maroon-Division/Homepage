'use client';

import { useState, useEffect, useCallback } from 'react';
import { useToast } from '@/app/components/ui/ToastContainer';
import LoadingSpinner from '@/app/components/ui/LoadingSpinner';
import ConfirmModal from '@/app/components/ui/ConfirmModal';

interface AttendanceRecord {
  id: number;
  status: 'present' | 'absent' | 'late' | 'gone_early' | 'partial' | 'no_show';
  minutesLate: number;
  minutesGoneEarly: number;
  totalMinutesMissed: number;
  notes: string | null;
  user: {
    id: number;
    username: string;
  };
  signup?: {
    user: {
      id: number;
      username: string;
    };
    subslot: {
      name: string;
      slot: {
        name: string;
      };
    };
  };
  logs: Array<{
    id: number;
    action: string;
    source: string;
    timestamp: string;
    changedBy: {
      username: string;
    } | null;
  }>;
}

interface AttendanceModalProps {
  show: boolean;
  attendanceId?: number;
  orbatId: number;
  signupId?: number;
  onClose: () => void;
  onSave: () => void;
}

function AttendanceForm({
  show,
  attendanceId,
  orbatId,
  signupId: initialSignupId,
  onClose,
  onSave,
}: AttendanceModalProps) {
  const [isSaving, setIsSaving] = useState(false);
  const [signupId, setSignupId] = useState<number | undefined>(initialSignupId);
  const [userId, setUserId] = useState<number | undefined>();
  const [signups, setSignups] = useState<Array<{ id: number; user: { id: number; username: string } }>>([]);
  const [allUsers, setAllUsers] = useState<Array<{ id: number; username: string }>>([]);
  const [isLoadingSignups, setIsLoadingSignups] = useState(false);
  const [status, setStatus] = useState<string>('absent');
  const [notes, setNotes] = useState('');
  const { showToast } = useToast();

  useEffect(() => {
    if (show && attendanceId) {
      // Fetch existing attendance when editing
      const fetchAttendance = async () => {
        setIsLoadingSignups(true);
        try {
          const response = await fetch(`/api/attendance/${attendanceId}`);
          if (response.ok) {
            const data = await response.json();
            setSignupId(data.signupId || undefined);
            setUserId(data.userId);
            setStatus(data.status || 'absent');
            setNotes(data.notes || '');
          }
        } catch (error) {
          console.error('Error fetching attendance:', error);
        } finally {
          setIsLoadingSignups(false);
        }
      };
      fetchAttendance();
    } else if (show && !attendanceId) {
      // Fetch available signups and all users when opening form for new attendance
      const fetchData = async () => {
        setIsLoadingSignups(true);
        try {
          const [signupsRes, usersRes] = await Promise.all([
            fetch(`/api/orbats/${orbatId}/signups`),
            fetch(`/api/users`),
          ]);
          if (signupsRes.ok) {
            const data = await signupsRes.json();
            setSignups(data);
          }
          if (usersRes.ok) {
            const data = await usersRes.json();
            setAllUsers(data);
          }
        } catch (error) {
          console.error('Error fetching data:', error);
        } finally {
          setIsLoadingSignups(false);
        }
      };
      fetchData();
    }
  }, [show, attendanceId, orbatId]);

  useEffect(() => {
    if (!show) {
      setSignupId(initialSignupId);
      setUserId(undefined);
      setStatus('absent');
      setNotes('');
    }
  }, [show, initialSignupId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!signupId && !userId) {
      showToast('Please select a user', 'error');
      return;
    }
    
    setIsSaving(true);

    try {
      const payload = {
        signupId: signupId || null,
        userId: userId || null,
        status,
        notes,
      };

      const url = attendanceId
        ? `/api/attendance/${attendanceId}`
        : `/api/orbats/${orbatId}/attendance`;

      const method = attendanceId ? 'PUT' : 'POST';

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error('Failed to save attendance');
      }

      showToast('Attendance saved successfully', 'success');
      onSave();
      onClose();
    } catch (error) {
      console.error('Error saving attendance:', error);
      showToast('Failed to save attendance', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  if (!show) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in" style={{ backgroundColor: 'rgba(0, 0, 0, 0.5)' }}>
      <div
        className="rounded-lg shadow-xl max-w-md w-full p-6 space-y-4 border animate-scale-in"
        style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-xl font-semibold" style={{ color: 'var(--foreground)' }}>
          {attendanceId ? 'Edit Attendance' : 'Create Attendance'}
        </h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          {!attendanceId && (
            <>
              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: 'var(--foreground)' }}>
                  User (Signed Up)
                </label>
                <select
                  value={signupId || ''}
                  onChange={(e) => {
                    const value = e.target.value ? parseInt(e.target.value) : undefined;
                    setSignupId(value);
                    if (value) {
                      // Auto-fill userId from signup
                      const signup = signups.find(s => s.id === value);
                      if (signup) setUserId(signup.user.id);
                    }
                  }}
                  className="w-full border rounded-md px-3 py-2"
                  style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
                  disabled={isLoadingSignups}
                >
                  <option value="">{isLoadingSignups ? 'Loading...' : 'Select a signed-up user...'}</option>
                  {signups.map((signup) => (
                    <option key={signup.id} value={signup.id}>
                      {signup.user.username} (Signed Up)
                    </option>
                  ))}
                </select>
              </div>

              <div className="text-center text-sm" style={{ color: 'var(--muted-foreground)' }}>— OR —</div>

              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: 'var(--foreground)' }}>
                  User (Not Signed Up)
                </label>
                <select
                  value={userId || ''}
                  onChange={(e) => {
                    const value = e.target.value ? parseInt(e.target.value) : undefined;
                    setUserId(value);
                    if (value) setSignupId(undefined); // Clear signup if user selected
                  }}
                  className="w-full border rounded-md px-3 py-2"
                  style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
                  disabled={isLoadingSignups}
                >
                  <option value="">{isLoadingSignups ? 'Loading...' : 'Select any user...'}</option>
                  {allUsers
                    .filter(user => !signups.some(s => s.user.id === user.id)) // Exclude users who signed up
                    .map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.username}
                      </option>
                    ))}
                </select>
              </div>
            </>
          )}

          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: 'var(--foreground)' }}>Status</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="w-full border rounded-md px-3 py-2"
              style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
            >
              <option value="present">Present</option>
              <option value="absent">Absent</option>
              <option value="late">Late</option>
              <option value="gone_early">Gone Early</option>
              <option value="partial">Partial</option>
              <option value="no_show">No Show</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: 'var(--foreground)' }}>Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full border rounded-md px-3 py-2"
              rows={3}
              style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="px-4 py-2 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ backgroundColor: 'var(--secondary)', color: 'var(--foreground)' }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="px-4 py-2 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ backgroundColor: 'var(--primary)', color: 'var(--primary-foreground)' }}
            >
              {isSaving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface AttendanceDetailsModalProps {
  show: boolean;
  attendance?: AttendanceRecord;
  onClose: () => void;
}

function AttendanceDetailsModal({
  show,
  attendance,
  onClose,
}: AttendanceDetailsModalProps) {
  if (!show || !attendance) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in" style={{ backgroundColor: 'rgba(0, 0, 0, 0.5)' }}>
      <div
        className="rounded-lg shadow-xl max-w-2xl w-full p-6 space-y-4 border animate-scale-in max-h-96 overflow-y-auto"
        style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-xl font-semibold" style={{ color: 'var(--foreground)' }}>
          Attendance Details
        </h2>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm font-medium" style={{ color: 'var(--muted-foreground)' }}>User</p>
              <p className="font-semibold" style={{ color: 'var(--foreground)' }}>
                {attendance.signup?.user?.username || attendance.user?.username}
                {!attendance.signup && ' (No Signup)'}
              </p>
            </div>
            <div>
              <p className="text-sm font-medium" style={{ color: 'var(--muted-foreground)' }}>Status</p>
              <p className="font-semibold" style={{ color: 'var(--foreground)' }}>{attendance.status}</p>
            </div>
            <div>
              <p className="text-sm font-medium" style={{ color: 'var(--muted-foreground)' }}>Minutes Late</p>
              <p className="font-semibold" style={{ color: 'var(--foreground)' }}>{attendance.minutesLate} min</p>
            </div>
            <div>
              <p className="text-sm font-medium" style={{ color: 'var(--muted-foreground)' }}>Minutes Gone Early</p>
              <p className="font-semibold" style={{ color: 'var(--foreground)' }}>{attendance.minutesGoneEarly} min</p>
            </div>
            {attendance.notes && (
              <div className="col-span-2">
                <p className="text-sm font-medium mb-1" style={{ color: 'var(--muted-foreground)' }}>Notes</p>
                <p style={{ color: 'var(--foreground)' }}>{attendance.notes}</p>
              </div>
            )}
          </div>

          <div className="border-t pt-4" style={{ borderColor: 'var(--border)' }}>
            <h3 className="font-semibold mb-2" style={{ color: 'var(--foreground)' }}>Change History</h3>
            <div className="space-y-2 text-sm">
              {attendance.logs.map((log) => (
                <div key={log.id} className="flex justify-between">
                  <span style={{ color: 'var(--foreground)' }}>
                    {log.action.replace(/_/g, ' ')} by{' '}
                    {log.changedBy?.username || 'System'}
                  </span>
                  <span style={{ color: 'var(--muted-foreground)' }}>
                    {new Date(log.timestamp).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-md transition-colors"
            style={{ backgroundColor: 'var(--secondary)', color: 'var(--foreground)' }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AttendanceManagement({ orbatId }: { orbatId: number }) {
  const [attendances, setAttendances] = useState<AttendanceRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState(
    new Date().toISOString().split('T')[0]
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [showForm, setShowForm] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [selectedAttendance, setSelectedAttendance] = useState<AttendanceRecord>();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteId, setDeleteId] = useState<number>();
  const { showToast } = useToast();

  const fetchAttendances = useCallback(async () => {
    setIsLoading(true);
    try {
      const query = new URLSearchParams();
      query.append('date', selectedDate);

      const response = await fetch(`/api/orbats/${orbatId}/attendance?${query}`);
      if (!response.ok) throw new Error('Failed to fetch attendance');

      const data = await response.json();
      setAttendances(data);
    } catch (error) {
      console.error('Error fetching attendance:', error);
      showToast('Failed to load attendance', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [orbatId, selectedDate, showToast]);

  useEffect(() => {
    fetchAttendances();
  }, [fetchAttendances]);

  const handleDelete = async () => {
    if (!deleteId) return;

    try {
      const response = await fetch(`/api/attendance/${deleteId}`, {
        method: 'DELETE',
      });

      if (!response.ok) throw new Error('Failed to delete attendance');

      showToast('Attendance deleted successfully', 'success');
      setConfirmDelete(false);
      setDeleteId(undefined);
      fetchAttendances();
    } catch (error) {
      console.error('Error deleting attendance:', error);
      showToast('Failed to delete attendance', 'error');
    }
  };

  // Filter attendances
  const filteredAttendances = attendances.filter((attendance) => {
    // Apply status filter
    if (statusFilter !== 'all' && attendance.status !== statusFilter) {
      return false;
    }

    // Apply search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      const username = attendance.signup?.user?.username || attendance.user?.username || '';
      return username.toLowerCase().includes(query);
    }

    return true;
  });

  const statusCounts = {
    all: attendances.length,
    present: attendances.filter((a) => a.status === 'present').length,
    absent: attendances.filter((a) => a.status === 'absent').length,
    late: attendances.filter((a) => a.status === 'late').length,
    no_show: attendances.filter((a) => a.status === 'no_show').length,
  };

  const statusColors: Record<string, string> = {
    present: '#16a34a',
    absent: '#dc2626',
    late: '#eab308',
    gone_early: '#f97316',
    partial: '#f97316',
    no_show: '#dc2626',
  };

  return (
    <div className="border rounded-lg overflow-hidden" style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)' }}>
      <div className="px-6 py-4 flex justify-between items-center" style={{ borderBottomWidth: '1px', borderColor: 'var(--border)' }}>
        <div>
          <h2 className="text-xl font-semibold" style={{ color: 'var(--foreground)' }}>Attendance Records</h2>
          <p className="text-sm mt-1" style={{ color: 'var(--muted-foreground)' }}>
            Track and manage user attendance
          </p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="px-4 py-2 rounded-md transition-colors font-medium"
          style={{ backgroundColor: 'var(--primary)', color: 'var(--primary-foreground)' }}
        >
          Create Attendance
        </button>
      </div>

      {/* Filters */}
      <div className="px-6 py-4 flex flex-col sm:flex-row gap-4" style={{ borderBottomWidth: '1px', borderColor: 'var(--border)' }}>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setStatusFilter('all')}
            className="px-4 py-2 rounded-md font-medium transition-colors text-sm"
            style={{
              backgroundColor: statusFilter === 'all' ? 'var(--primary)' : 'var(--muted)',
              color: statusFilter === 'all' ? 'var(--primary-foreground)' : 'var(--foreground)'
            }}
          >
            All ({statusCounts.all})
          </button>
          <button
            onClick={() => setStatusFilter('present')}
            className="px-4 py-2 rounded-md font-medium transition-colors text-sm"
            style={{
              backgroundColor: statusFilter === 'present' ? 'var(--primary)' : 'var(--muted)',
              color: statusFilter === 'present' ? 'var(--primary-foreground)' : 'var(--foreground)'
            }}
          >
            Present ({statusCounts.present})
          </button>
          <button
            onClick={() => setStatusFilter('late')}
            className="px-4 py-2 rounded-md font-medium transition-colors text-sm"
            style={{
              backgroundColor: statusFilter === 'late' ? 'var(--primary)' : 'var(--muted)',
              color: statusFilter === 'late' ? 'var(--primary-foreground)' : 'var(--foreground)'
            }}
          >
            Late ({statusCounts.late})
          </button>
          <button
            onClick={() => setStatusFilter('absent')}
            className="px-4 py-2 rounded-md font-medium transition-colors text-sm"
            style={{
              backgroundColor: statusFilter === 'absent' ? 'var(--primary)' : 'var(--muted)',
              color: statusFilter === 'absent' ? 'var(--primary-foreground)' : 'var(--foreground)'
            }}
          >
            Absent ({statusCounts.absent})
          </button>
          <button
            onClick={() => setStatusFilter('no_show')}
            className="px-4 py-2 rounded-md font-medium transition-colors text-sm"
            style={{
              backgroundColor: statusFilter === 'no_show' ? 'var(--primary)' : 'var(--muted)',
              color: statusFilter === 'no_show' ? 'var(--primary-foreground)' : 'var(--foreground)'
            }}
          >
            No Show ({statusCounts.no_show})
          </button>
        </div>

        <div className="flex gap-2 flex-1">
          <input
            type="text"
            placeholder="Search by username..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="flex-1 px-4 py-2 border rounded-md focus:outline-none focus:ring-2"
            style={{ 
              backgroundColor: 'var(--background)', 
              borderColor: 'var(--border)', 
              color: 'var(--foreground)'
            }}
          />
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="px-4 py-2 border rounded-md focus:outline-none focus:ring-2"
            style={{ 
              backgroundColor: 'var(--background)', 
              borderColor: 'var(--border)', 
              color: 'var(--foreground)'
            }}
          />
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <LoadingSpinner />
        </div>
      ) : filteredAttendances.length === 0 ? (
        <div className="px-6 py-12 text-center" style={{ color: 'var(--muted-foreground)' }}>
          <p>No attendance records found</p>
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
                  Status
                </th>
                <th className="px-6 py-3 text-center text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--muted-foreground)' }}>
                  Minutes Late
                </th>
                <th className="px-6 py-3 text-center text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--muted-foreground)' }}>
                  Minutes Gone Early
                </th>
                <th className="px-6 py-3 text-center text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--muted-foreground)' }}>
                  Actions
                </th>
              </tr>
            </thead>
            <tbody style={{ borderTopWidth: '1px', borderColor: 'var(--border)' }}>
              {filteredAttendances.map((attendance) => (
                <tr key={attendance.id} style={{ borderBottomWidth: '1px', borderColor: 'var(--border)' }}>
                  <td className="px-6 py-4 whitespace-nowrap text-sm" style={{ color: 'var(--foreground)' }}>
                    {attendance.signup?.user?.username || attendance.user?.username}
                    {!attendance.signup && <span className="ml-1 text-xs" style={{ color: 'var(--muted-foreground)' }}>(No Signup)</span>}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span
                      className="inline-block px-3 py-1 rounded text-xs font-medium"
                      style={{ 
                        backgroundColor: statusColors[attendance.status] + '20',
                        color: statusColors[attendance.status]
                      }}
                    >
                      {attendance.status.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-center text-sm" style={{ color: 'var(--foreground)' }}>
                    {attendance.minutesLate}
                  </td>
                  <td className="px-6 py-4 text-center text-sm" style={{ color: 'var(--foreground)' }}>
                    {attendance.minutesGoneEarly}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-center space-x-2">
                    <button
                      onClick={() => {
                        setSelectedAttendance(attendance);
                        setShowDetails(true);
                      }}
                      className="font-medium hover:underline"
                      style={{ color: 'var(--primary)' }}
                    >
                      View
                    </button>
                    <span style={{ color: 'var(--border)' }}>|</span>
                    <button
                      onClick={() => {
                        setSelectedAttendance(attendance);
                        setShowForm(true);
                      }}
                      className="font-medium hover:underline"
                      style={{ color: 'var(--primary)' }}
                    >
                      Edit
                    </button>
                    <span style={{ color: 'var(--border)' }}>|</span>
                    <button
                      onClick={() => {
                        setDeleteId(attendance.id);
                        setConfirmDelete(true);
                      }}
                      className="font-medium hover:underline"
                      style={{ color: '#dc2626' }}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <AttendanceForm
        show={showForm}
        attendanceId={selectedAttendance?.id}
        orbatId={orbatId}
        signupId={selectedAttendance?.id}
        onClose={() => {
          setShowForm(false);
          setSelectedAttendance(undefined);
        }}
        onSave={() => {
          fetchAttendances();
        }}
      />

      <AttendanceDetailsModal
        show={showDetails}
        attendance={selectedAttendance}
        onClose={() => {
          setShowDetails(false);
          setSelectedAttendance(undefined);
        }}
      />

      <ConfirmModal
        isOpen={confirmDelete}
        title="Delete Attendance"
        message="Are you sure you want to delete this attendance record?"
        onConfirm={handleDelete}
        onCancel={() => {
          setConfirmDelete(false);
          setDeleteId(undefined);
        }}
      />
    </div>
  );
}
