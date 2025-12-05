'use client';

import { useState, useEffect } from 'react';
import CssEditor from '@/app/components/CssEditor';
import CssLegend from '@/app/components/CssLegend';

interface ThemeSubmission {
  id: number;
  status: string;
  message: string | null;
  adminMessage: string | null;
  submissionType: string;
  createdAt: string;
  submittedBy: {
    id: number;
    username: string | null;
  };
  snapshotName: string;
  snapshotBackground: string;
  snapshotForeground: string;
  snapshotPrimary: string;
  snapshotPrimaryForeground: string;
  snapshotSecondary: string;
  snapshotSecondaryForeground: string;
  snapshotAccent: string;
  snapshotAccentForeground: string;
  snapshotMuted: string;
  snapshotMutedForeground: string;
  snapshotBorder: string;
  snapshotCustomCss: string | null;
}

interface Theme {
  id: number;
  name: string;
  type?: string;
  parentThemeId?: number | null;
  isPublic: boolean;
  isDefaultLight: boolean;
  isDefaultDark: boolean;
  isEnabled: boolean;
  customCss?: string | null;
  createdById: number | null;
  background: string;
  foreground: string;
  primary: string;
  primaryForeground: string;
  secondary: string;
  secondaryForeground: string;
  accent: string;
  accentForeground: string;
  muted: string;
  mutedForeground: string;
  border: string;
  createdBy?: {
    id: number;
    username: string | null;
  } | null;
  submissions?: ThemeSubmission[];
  parentTheme?: {
    id: number;
    name: string;
    background: string;
    foreground: string;
    primary: string;
    primaryForeground: string;
    secondary: string;
    secondaryForeground: string;
    accent: string;
    accentForeground: string;
    muted: string;
    mutedForeground: string;
    border: string;
    customCss: string | null;
  } | null;
}

export default function ThemeManagementClient() {
  const [themes, setThemes] = useState<Theme[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingTheme, setEditingTheme] = useState<Theme | null>(null);
  const [rejectingSubmissionId, setRejectingSubmissionId] = useState<number | null>(null);
  const [reviewingSubmission, setReviewingSubmission] = useState<{ theme: Theme; submission: ThemeSubmission; parentTheme: Theme | null } | null>(null);
  const [adminMessage, setAdminMessage] = useState('');
  const [newTheme, setNewTheme] = useState({
    name: '',
    background: '#0a0a0a',
    foreground: '#ededed',
    primary: '#3b82f6',
    primaryForeground: '#ffffff',
    secondary: '#1e293b',
    secondaryForeground: '#f1f5f9',
    accent: '#8b5cf6',
    accentForeground: '#ffffff',
    muted: '#1e293b',
    mutedForeground: '#94a3b8',
    border: '#334155',
    isDefaultLight: false,
    isDefaultDark: false,
    isEnabled: true,
    customCss: '',
  });
  const [showAdvanced, setShowAdvanced] = useState(false);

  const fetchThemes = async () => {
    try {
      const response = await fetch('/api/themes/admin');
      if (response.ok) {
        const data = await response.json();
        setThemes(data);
      }
    } catch (error) {
      console.error('Error fetching themes:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchThemes();
  }, []);

  const handleCreateTheme = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const response = await fetch('/api/themes/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newTheme),
      });

      if (response.ok) {
        setShowCreateForm(false);
        setNewTheme({
          name: '',
          background: '#0a0a0a',
          foreground: '#ededed',
          primary: '#3b82f6',
          primaryForeground: '#ffffff',
          secondary: '#1e293b',
          secondaryForeground: '#f1f5f9',
          accent: '#8b5cf6',
          accentForeground: '#ffffff',
          muted: '#1e293b',
          mutedForeground: '#94a3b8',
          border: '#334155',
          isDefaultLight: false,
          isDefaultDark: false,
          isEnabled: true,
          customCss: '',
        });
        fetchThemes();
      } else {
        const error = await response.json();
        alert(error.error || 'Failed to create theme');
      }
    } catch (error) {
      console.error('Error creating theme:', error);
      alert('Failed to create theme');
    }
  };

  const handleDeleteTheme = async (themeId: number) => {
    if (!confirm('Are you sure you want to delete this theme?')) return;

    try {
      const response = await fetch(`/api/themes/admin/${themeId}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        fetchThemes();
      } else {
        const error = await response.json();
        alert(error.error || 'Failed to delete theme');
      }
    } catch (error) {
      console.error('Error deleting theme:', error);
      alert('Failed to delete theme');
    }
  };

  const handleEditTheme = (theme: Theme) => {
    setEditingTheme(theme);
    setShowCreateForm(false);
  };

  const handleUpdateTheme = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTheme) return;

    try {
      const response = await fetch(`/api/themes/admin/${editingTheme.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editingTheme.name,
          background: editingTheme.background,
          foreground: editingTheme.foreground,
          primary: editingTheme.primary,
          primaryForeground: editingTheme.primaryForeground,
          secondary: editingTheme.secondary,
          secondaryForeground: editingTheme.secondaryForeground,
          accent: editingTheme.accent,
          accentForeground: editingTheme.accentForeground,
          muted: editingTheme.muted,
          mutedForeground: editingTheme.mutedForeground,
          border: editingTheme.border,
          isDefaultLight: editingTheme.isDefaultLight,
          isDefaultDark: editingTheme.isDefaultDark,
          customCss: editingTheme.customCss || null,
        }),
      });

      if (response.ok) {
        setEditingTheme(null);
        fetchThemes();
      } else {
        const error = await response.json();
        alert(error.error || 'Failed to update theme');
      }
    } catch (error) {
      console.error('Error updating theme:', error);
      alert('Failed to update theme');
    }
  };

  const handleApproveSubmission = async (submissionId: number) => {
    try {
      const response = await fetch(
        `/api/themes/admin/submissions/${submissionId}/approve`,
        { method: 'POST' }
      );

      if (response.ok) {
        fetchThemes();
      } else {
        alert('Failed to approve submission');
      }
    } catch (error) {
      console.error('Error approving submission:', error);
      alert('Failed to approve submission');
    }
  };

  const handleToggleEnabled = async (themeId: number, currentEnabled: boolean) => {
    try {
      const response = await fetch(`/api/themes/admin/${themeId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isEnabled: !currentEnabled }),
      });

      if (response.ok) {
        fetchThemes();
      } else {
        const error = await response.json();
        alert(error.error || 'Failed to toggle theme');
      }
    } catch (error) {
      console.error('Error toggling theme:', error);
      alert('Failed to toggle theme');
    }
  };

  const handleRejectSubmission = async (submissionId: number, message: string) => {
    try {
      const response = await fetch(
        `/api/themes/admin/submissions/${submissionId}/reject`,
        { 
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ adminMessage: message }),
        }
      );

      if (response.ok) {
        setRejectingSubmissionId(null);
        setAdminMessage('');
        fetchThemes();
      } else {
        alert('Failed to reject submission');
      }
    } catch (error) {
      console.error('Error rejecting submission:', error);
      alert('Failed to reject submission');
    }
  };

  if (loading) {
    return <div className="p-8">Loading themes...</div>;
  }

  const pendingSubmissions = themes.filter(
    (t) => t.submissions && t.submissions.some((s) => s.status === 'pending')
  );

  const publicThemes = themes.filter((t) => t.isPublic);
  const customThemes = themes.filter((t) => !t.isPublic && t.createdById);

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold">Theme Management</h1>
        <button
          onClick={() => {
            setShowCreateForm(!showCreateForm);
            setEditingTheme(null);
          }}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          {showCreateForm ? 'Cancel' : 'Create New Theme'}
        </button>
      </div>

      {editingTheme && (
        <div className="mb-8 p-6 border rounded-lg bg-secondary">
          <h2 className="text-xl font-bold mb-4">Edit Theme: {editingTheme.name}</h2>
          <form onSubmit={handleUpdateTheme} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">
                  Theme Name
                </label>
                <input
                  type="text"
                  value={editingTheme.name}
                  onChange={(e) =>
                    setEditingTheme({ ...editingTheme, name: e.target.value })
                  }
                  className="w-full px-3 py-2 border rounded bg-background"
                  required
                />
              </div>
              <div className="flex items-center gap-4">
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={editingTheme.isDefaultLight}
                    onChange={(e) =>
                      setEditingTheme({ ...editingTheme, isDefaultLight: e.target.checked })
                    }
                    className="mr-2"
                  />
                  <span className="text-sm font-medium">Default Light Theme</span>
                </label>
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={editingTheme.isDefaultDark}
                    onChange={(e) =>
                      setEditingTheme({ ...editingTheme, isDefaultDark: e.target.checked })
                    }
                    className="mr-2"
                  />
                  <span className="text-sm font-medium">Default Dark Theme</span>
                </label>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              {(['background', 'foreground', 'primary', 'primaryForeground', 'secondary', 'secondaryForeground', 'accent', 'accentForeground', 'muted', 'mutedForeground', 'border'] as const).map((key) => (
                <div key={key}>
                  <label className="block text-sm font-medium mb-1 capitalize">
                    {key.replace(/([A-Z])/g, ' $1').trim()}
                  </label>
                  <input
                    type="color"
                    value={editingTheme[key]}
                    onChange={(e) =>
                      setEditingTheme({ ...editingTheme, [key]: e.target.value })
                    }
                    className="w-full h-10 border rounded cursor-pointer"
                  />
                </div>
              ))}
            </div>

            <div>
              <button
                type="button"
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700 mb-2"
              >
                {showAdvanced ? 'Hide' : 'Show'} Advanced CSS
              </button>
              
              {showAdvanced && (
                <div>
                  <label className="block text-sm font-medium mb-2">
                    Custom CSS (Advanced)
                  </label>
                  <p className="text-sm text-muted-foreground mb-2">
                    Add custom CSS to completely override styles. Use with caution!
                  </p>
                  <div className="mb-4">
                    <CssLegend />
                  </div>
                  <CssEditor
                    value={editingTheme.customCss || ''}
                    onChange={(value) =>
                      setEditingTheme({ ...editingTheme, customCss: value })
                    }
                    height="400px"
                  />
                </div>
              )}
            </div>

            {/* Submission History */}
            {editingTheme.submissions && editingTheme.submissions.length > 0 && (
              <div className="border rounded-lg p-4 bg-background">
                <h4 className="font-semibold mb-3">Submission History (All Messages)</h4>
                <div className="space-y-3 max-h-96 overflow-y-auto">
                  {editingTheme.submissions.map((submission, index) => {
                    // Determine what to compare against
                    const nextSubmission = editingTheme.submissions?.[index + 1];
                    const baseForComparison = nextSubmission || editingTheme.parentTheme;
                    
                    // Calculate changes
                    const colorChanges = baseForComparison ? (['background', 'foreground', 'primary', 'primaryForeground', 'secondary', 'secondaryForeground', 'accent', 'accentForeground', 'muted', 'mutedForeground', 'border'] as const)
                      .map(key => {
                        const snapshotKey = `snapshot${key.charAt(0).toUpperCase()}${key.slice(1)}` as keyof typeof submission;
                        const newValue = submission[snapshotKey] as string;
                        const oldValue = nextSubmission 
                          ? (nextSubmission[snapshotKey] as string)
                          : String(baseForComparison[key as keyof typeof baseForComparison] || '');
                        return { key, changed: newValue !== oldValue, newValue, oldValue };
                      })
                      .filter(change => change.changed) : [];

                    const cssChanged = baseForComparison && 
                      (submission.snapshotCustomCss || '') !== (nextSubmission?.snapshotCustomCss || (('customCss' in baseForComparison) ? baseForComparison.customCss : '') || '');

                    return (
                    <div 
                      key={submission.id}
                      className="border-l-4 pl-3 py-2"
                      style={{ 
                        borderLeftColor: submission.status === 'approved' ? '#22c55e' : submission.status === 'rejected' ? '#ef4444' : '#eab308'
                      }}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-semibold">
                          {submission.status === 'approved' ? '✅ Approved' : submission.status === 'rejected' ? '❌ Rejected' : '⏳ Pending'}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {new Date(submission.createdAt).toLocaleDateString()} {new Date(submission.createdAt).toLocaleTimeString()}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          by {submission.submittedBy?.username || 'Unknown'}
                        </span>
                      </div>
                      
                      {/* Show changes */}
                      {colorChanges.length > 0 && (
                        <div className="text-xs mb-2 p-2 rounded bg-secondary">
                          <span className="font-semibold text-muted-foreground">Colors changed: </span>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {colorChanges.map(change => (
                              <div key={change.key} className="flex items-center gap-1 px-1 py-0.5 rounded bg-background">
                                <div className="w-3 h-3 rounded border border-border" style={{ backgroundColor: change.newValue }} />
                                <span className="text-foreground">{change.key.replace(/([A-Z])/g, ' $1').trim()}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {cssChanged && (
                        <div className="text-xs mb-2 p-2 rounded bg-secondary text-muted-foreground">
                          🎨 Custom CSS modified
                        </div>
                      )}
                      
                      {submission.message && (
                        <div className="text-sm mb-2 p-2 rounded bg-secondary">
                          <span className="font-semibold text-muted-foreground">User: </span>
                          <span>{submission.message}</span>
                        </div>
                      )}
                      {submission.adminMessage && (
                        <div className="text-sm p-2 rounded bg-secondary">
                          <span className="font-semibold text-muted-foreground">Admin: </span>
                          <span>{submission.adminMessage}</span>
                        </div>
                      )}
                    </div>
                  );
                  })}
                </div>
              </div>
            )}

            <div className="flex gap-2">
              <button
                type="submit"
                className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
              >
                Update Theme
              </button>
              <button
                type="button"
                onClick={() => setEditingTheme(null)}
                className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {showCreateForm && (
        <div className="mb-8 p-6 border rounded-lg bg-secondary">
          <h2 className="text-xl font-bold mb-4">Create New Public Theme</h2>
          <form onSubmit={handleCreateTheme} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">
                  Theme Name
                </label>
                <input
                  type="text"
                  value={newTheme.name}
                  onChange={(e) =>
                    setNewTheme({ ...newTheme, name: e.target.value })
                  }
                  className="w-full px-3 py-2 border rounded bg-background"
                  required
                />
              </div>
              <div className="flex items-center gap-4">
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={newTheme.isDefaultLight}
                    onChange={(e) =>
                      setNewTheme({ ...newTheme, isDefaultLight: e.target.checked })
                    }
                    className="mr-2"
                  />
                  <span className="text-sm font-medium">Default Light Theme</span>
                </label>
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={newTheme.isDefaultDark}
                    onChange={(e) =>
                      setNewTheme({ ...newTheme, isDefaultDark: e.target.checked })
                    }
                    className="mr-2"
                  />
                  <span className="text-sm font-medium">Default Dark Theme</span>
                </label>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              {Object.entries(newTheme)
                .filter(([key]) => !['name', 'isDefaultLight', 'isDefaultDark', 'isEnabled', 'customCss'].includes(key))
                .map(([key, value]) => (
                  <div key={key}>
                    <label className="block text-sm font-medium mb-1 capitalize">
                      {key.replace(/([A-Z])/g, ' $1').trim()}
                    </label>
                    <input
                      type="color"
                      value={value as string}
                      onChange={(e) =>
                        setNewTheme({ ...newTheme, [key]: e.target.value })
                      }
                      className="w-full h-10 border rounded cursor-pointer"
                    />
                  </div>
                ))}
            </div>

            <div>
              <button
                type="button"
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700 mb-2"
              >
                {showAdvanced ? 'Hide' : 'Show'} Advanced CSS
              </button>
              
              {showAdvanced && (
                <div>
                  <label className="block text-sm font-medium mb-2">
                    Custom CSS (Advanced)
                  </label>
                  <p className="text-sm text-muted-foreground mb-2">
                    Add custom CSS to completely override styles. Use with caution!
                  </p>
                  <div className="mb-4">
                    <CssLegend />
                  </div>
                  <CssEditor
                    value={newTheme.customCss}
                    onChange={(value) =>
                      setNewTheme({ ...newTheme, customCss: value })
                    }
                    height="400px"
                  />
                </div>
              )}
            </div>

            <button
              type="submit"
              className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
            >
              Create Theme
            </button>
          </form>
        </div>
      )}

      {pendingSubmissions.length > 0 && (
        <div className="mb-8">
          <h2 className="text-2xl font-bold mb-4">Pending Submissions</h2>
          <div className="space-y-4">
            {pendingSubmissions.map((theme) => {
              const pendingSub = theme.submissions?.find(
                (s) => s.status === 'pending'
              );
              if (!pendingSub) return null;

              return (
                <div
                  key={theme.id}
                  className="p-4 border rounded-lg bg-yellow-900/20 border-yellow-600"
                >
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <h3 className="text-lg font-bold">{theme.name}</h3>
                        <span className={`text-xs px-2 py-1 rounded ${
                          pendingSub.submissionType === 'update' 
                            ? 'bg-purple-600 text-white' 
                            : 'bg-green-600 text-white'
                        }`}>
                          {pendingSub.submissionType === 'update' 
                            ? `📝 Update "${theme.parentTheme?.name || 'Parent'}"` 
                            : '✨ New Theme'}
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        Submitted by: {pendingSub.submittedBy.username || 'Unknown'}
                      </p>
                      {pendingSub.message && (
                        <p className="text-sm mt-2">Message: {pendingSub.message}</p>
                      )}
                      <div className="mt-2 flex gap-2">
                        {Object.entries(theme)
                          .filter(([key]) =>
                            [
                              'background',
                              'foreground',
                              'primary',
                              'accent',
                            ].includes(key)
                          )
                          .map(([key, value]) => (
                            <div
                              key={key}
                              className="flex items-center gap-2"
                            >
                              <div
                                className="w-6 h-6 border rounded"
                                style={{ backgroundColor: value as string }}
                              />
                              <span className="text-xs capitalize">{key}</span>
                            </div>
                          ))}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={async () => {
                          let parentTheme = null;
                          if (theme.parentThemeId) {
                            // Fetch parent theme if it's a derived theme
                            const parent = themes.find(t => t.id === theme.parentThemeId);
                            parentTheme = parent || null;
                          }
                          setReviewingSubmission({ theme, submission: pendingSub, parentTheme });
                        }}
                        className="px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm"
                      >
                        Review
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Rejection Modal */}
      {rejectingSubmissionId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-background border border-border rounded-lg max-w-md w-full p-6">
            <h3 className="text-xl font-bold mb-4">Reject Submission</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Provide feedback to help the user improve their submission:
            </p>
            <textarea
              value={adminMessage}
              onChange={(e) => setAdminMessage(e.target.value)}
              placeholder="e.g., Please increase contrast on the primary color for better readability..."
              className="w-full p-2 bg-secondary border border-border rounded mb-4 min-h-[100px]"
            />
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => {
                  setRejectingSubmissionId(null);
                  setAdminMessage('');
                }}
                className="px-4 py-2 bg-secondary text-secondary-foreground rounded"
              >
                Cancel
              </button>
              <button
                onClick={() => handleRejectSubmission(rejectingSubmissionId, adminMessage)}
                className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
              >
                Reject & Send Feedback
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Review Modal */}
      {reviewingSubmission && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-background border border-border rounded-lg max-w-6xl w-full max-h-[90vh] overflow-y-auto p-6">
            <h3 className="text-2xl font-bold mb-4">Review Submission: {reviewingSubmission.submission.snapshotName}</h3>
            <div className="flex items-center gap-4 mb-4">
              <p className="text-sm text-muted-foreground">
                Submitted by: {reviewingSubmission.submission.submittedBy.username || 'Unknown'}
              </p>
              <span className={`text-xs px-3 py-1 rounded ${
                reviewingSubmission.submission.submissionType === 'update' 
                  ? 'bg-purple-600 text-white' 
                  : 'bg-green-600 text-white'
              }`}>
                {reviewingSubmission.submission.submissionType === 'update' 
                  ? `📝 Update "${reviewingSubmission.theme.parentTheme?.name || 'Parent Theme'}"` 
                  : '✨ New Public Theme'}
              </span>
            </div>
            {reviewingSubmission.submission.message && (
              <div className="mb-4 p-3 bg-blue-900/20 border border-blue-600 rounded">
                <p className="text-sm font-semibold">User Message:</p>
                <p className="text-sm mt-1">{reviewingSubmission.submission.message}</p>
              </div>
            )}

            {/* Color Comparisons */}
            <div className="mb-6">
              {(() => {
                // Find last rejected submission from the same user
                const lastRejectedSubmission = reviewingSubmission.theme.submissions
                  ?.filter(sub => 
                    sub.id !== reviewingSubmission.submission.id && 
                    sub.status === 'rejected' &&
                    sub.submittedBy.id === reviewingSubmission.submission.submittedBy.id
                  )
                  .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];

                const hasRejectedVersion = !!lastRejectedSubmission;

                return (
                  <>
                    <h4 className="text-lg font-bold mb-3">
                      Color Changes
                      {reviewingSubmission.parentTheme && (
                        <span className="text-sm font-normal text-muted-foreground ml-2">
                          (comparing to parent: {reviewingSubmission.parentTheme.name})
                        </span>
                      )}
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {(['background', 'foreground', 'primary', 'primaryForeground', 'secondary', 'secondaryForeground', 'accent', 'accentForeground', 'muted', 'mutedForeground', 'border'] as const).map((key) => {
                        // Use parent theme for comparison if it exists, otherwise use current theme
                        const baseTheme = reviewingSubmission.parentTheme || reviewingSubmission.theme;
                        const parentColor = baseTheme[key];
                        const snapshotKey = `snapshot${key.charAt(0).toUpperCase()}${key.slice(1)}` as keyof typeof reviewingSubmission.submission;
                        const proposedColor = reviewingSubmission.submission[snapshotKey] as string;
                        const rejectedColor = lastRejectedSubmission ? (lastRejectedSubmission[snapshotKey] as string) : null;
                        
                        const hasChanged = parentColor !== proposedColor;
                        const changedFromRejected = rejectedColor && rejectedColor !== proposedColor;

                        return (
                          <div
                            key={key}
                            className={`p-3 border rounded ${
                              hasChanged ? 'bg-yellow-900/20 border-yellow-600' : 'bg-secondary border-border'
                            }`}
                          >
                            <p className="text-sm font-semibold mb-2 capitalize flex items-center gap-2">
                              {key.replace(/([A-Z])/g, ' $1')}
                              {hasChanged && <span className="text-xs bg-yellow-600 px-2 py-0.5 rounded">Changed</span>}
                            </p>
                            <div className={`flex ${hasRejectedVersion ? 'flex-col gap-2' : 'gap-4 items-center'}`}>
                              <div className={`flex ${hasRejectedVersion ? 'items-center justify-between' : 'flex-1 items-center gap-4'}`}>
                                <div className={hasRejectedVersion ? 'flex-1' : ''}>
                                  <p className="text-xs text-muted-foreground mb-1">{reviewingSubmission.parentTheme ? 'Parent' : 'Current'}</p>
                                  <div className="flex items-center gap-2">
                                    <div
                                      className="w-12 h-12 border-2 rounded"
                                      style={{ backgroundColor: parentColor }}
                                    />
                                    <span className="text-xs font-mono">{parentColor}</span>
                                  </div>
                                </div>
                                {!hasRejectedVersion && (
                                  <>
                                    <div className="text-2xl">→</div>
                                    <div className="flex-1">
                                      <p className="text-xs text-muted-foreground mb-1">Proposed</p>
                                      <div className="flex items-center gap-2">
                                        <div
                                          className={`w-12 h-12 border-2 rounded ${hasChanged ? 'border-yellow-600' : ''}`}
                                          style={{ backgroundColor: proposedColor }}
                                        />
                                        <span className="text-xs font-mono">{proposedColor}</span>
                                      </div>
                                    </div>
                                  </>
                                )}
                              </div>
                              {hasRejectedVersion && (
                                <>
                                  <div className="flex items-center justify-between">
                                    <div className="flex-1">
                                      <p className="text-xs text-red-400 mb-1">Last Rejected</p>
                                      <div className="flex items-center gap-2">
                                        <div
                                          className="w-12 h-12 border-2 border-red-600 rounded"
                                          style={{ backgroundColor: rejectedColor || parentColor }}
                                        />
                                        <span className="text-xs font-mono">{rejectedColor}</span>
                                      </div>
                                    </div>
                                  </div>
                                  <div className="flex items-center justify-between">
                                    <div className="flex-1">
                                      <p className="text-xs text-muted-foreground mb-1">Proposed</p>
                                      <div className="flex items-center gap-2">
                                        <div
                                          className={`w-12 h-12 border-2 rounded ${changedFromRejected ? 'border-yellow-600' : ''}`}
                                          style={{ backgroundColor: proposedColor }}
                                        />
                                        <span className="text-xs font-mono">{proposedColor}</span>
                                      </div>
                                    </div>
                                  </div>
                                </>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                );
              })()}
            </div>

            {/* CSS Comparison */}
            <div className="mb-6">
              {(() => {
                // Find last rejected submission from the same user
                const lastRejectedSubmission = reviewingSubmission.theme.submissions
                  ?.filter(sub => 
                    sub.id !== reviewingSubmission.submission.id && 
                    sub.status === 'rejected' &&
                    sub.submittedBy.id === reviewingSubmission.submission.submittedBy.id
                  )
                  .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];

                const hasRejectedVersion = !!lastRejectedSubmission;
                
                return (
                  <>
                    <h4 className="text-lg font-bold mb-3 flex items-center gap-2">
                      Custom CSS Changes
                      {((reviewingSubmission.parentTheme || reviewingSubmission.theme).customCss || '') !== (reviewingSubmission.submission.snapshotCustomCss || '') && (
                        <span className="text-xs bg-yellow-600 px-2 py-1 rounded">Modified</span>
                      )}
                    </h4>
                    <CssLegend />
                    <div className={`grid grid-cols-1 ${hasRejectedVersion ? 'md:grid-cols-3' : 'md:grid-cols-2'} gap-4 mt-4`}>
                      <div>
                        <p className="text-sm font-semibold mb-2">{reviewingSubmission.parentTheme ? 'Parent' : 'Current'} CSS</p>
                        <CssEditor
                          value={(reviewingSubmission.parentTheme || reviewingSubmission.theme).customCss || ''}
                          onChange={() => {}} // Read-only
                          height="300px"
                        />
                      </div>
                      {hasRejectedVersion && (
                        <div>
                          <p className="text-sm font-semibold mb-2 text-red-400">Last Rejected CSS</p>
                          <CssEditor
                            value={lastRejectedSubmission.snapshotCustomCss || ''}
                            onChange={() => {}} // Read-only
                            height="300px"
                          />
                        </div>
                      )}
                      <div>
                        <p className="text-sm font-semibold mb-2">Proposed CSS</p>
                        <CssEditor
                          value={reviewingSubmission.submission.snapshotCustomCss || ''}
                          onChange={() => {}} // Read-only
                          height="300px"
                        />
                      </div>
                    </div>
                  </>
                );
              })()}
            </div>

            {/* Submission History */}
            {reviewingSubmission.theme.submissions && reviewingSubmission.theme.submissions.length > 1 && (
              <div className="mb-6">
                <h4 className="text-lg font-bold mb-3">Previous Submissions</h4>
                <div className="space-y-3 max-h-60 overflow-y-auto">
                  {reviewingSubmission.theme.submissions
                    .filter(sub => sub.id !== reviewingSubmission.submission.id)
                    .map((submission, index, filteredArray) => {
                      // Determine what to compare against
                      const nextSubmission = filteredArray[index + 1];
                      const baseForComparison = nextSubmission || reviewingSubmission.theme.parentTheme;
                      
                      // Calculate changes
                      const colorChanges = baseForComparison ? (['background', 'foreground', 'primary', 'primaryForeground', 'secondary', 'secondaryForeground', 'accent', 'accentForeground', 'muted', 'mutedForeground', 'border'] as const)
                        .map(key => {
                          const snapshotKey = `snapshot${key.charAt(0).toUpperCase()}${key.slice(1)}` as keyof typeof submission;
                          const newValue = submission[snapshotKey] as string;
                          const oldValue = nextSubmission 
                            ? (nextSubmission[snapshotKey] as string)
                            : (baseForComparison[key as keyof typeof baseForComparison] as string);
                          return { key, changed: newValue !== oldValue, newValue };
                        })
                        .filter(change => change.changed) : [];

                      const cssChanged = baseForComparison && 
                        (submission.snapshotCustomCss || '') !== (nextSubmission?.snapshotCustomCss || (('customCss' in baseForComparison) ? baseForComparison.customCss : '') || '');

                      return (
                      <div 
                        key={submission.id}
                        className="border-l-4 pl-3 py-2 bg-secondary/50 rounded"
                        style={{ 
                          borderLeftColor: submission.status === 'approved' ? '#22c55e' : submission.status === 'rejected' ? '#ef4444' : '#eab308'
                        }}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-semibold">
                            {submission.status === 'approved' ? '✅ Approved' : submission.status === 'rejected' ? '❌ Rejected' : '⏳ Pending'}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {new Date(submission.createdAt).toLocaleDateString()} {new Date(submission.createdAt).toLocaleTimeString()}
                          </span>
                        </div>
                        
                        {/* Show changes */}
                        {colorChanges.length > 0 && (
                          <div className="text-xs mb-2 p-2 rounded bg-background">
                            <span className="font-semibold text-muted-foreground">Colors changed: </span>
                            <div className="flex flex-wrap gap-1 mt-1">
                              {colorChanges.map(change => (
                                <div key={change.key} className="flex items-center gap-1 px-1 py-0.5 rounded bg-secondary">
                                  <div className="w-3 h-3 rounded border border-border" style={{ backgroundColor: change.newValue }} />
                                  <span>{change.key.replace(/([A-Z])/g, ' $1').trim()}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {cssChanged && (
                          <div className="text-xs mb-2 p-2 rounded bg-background text-muted-foreground">
                            🎨 Custom CSS modified
                          </div>
                        )}
                        
                        {submission.message && (
                          <div className="text-sm mb-2 p-2 rounded bg-background">
                            <span className="font-semibold text-muted-foreground">User: </span>
                            <span>{submission.message}</span>
                          </div>
                        )}
                        {submission.adminMessage && (
                          <div className="text-sm p-2 rounded bg-background">
                            <span className="font-semibold text-muted-foreground">Admin: </span>
                            <span>{submission.adminMessage}</span>
                          </div>
                        )}
                      </div>
                    );
                    })}
                </div>
              </div>
            )}

            {/* Admin Actions */}
            <div className="border-t border-border pt-4">
              <h4 className="text-lg font-bold mb-3">Admin Actions</h4>
              <div className="mb-4">
                <label className="block text-sm font-medium mb-2">
                  Rejection Message (optional - only needed if rejecting)
                </label>
                <textarea
                  value={adminMessage}
                  onChange={(e) => setAdminMessage(e.target.value)}
                  placeholder="Provide feedback if rejecting..."
                  className="w-full p-2 bg-secondary border border-border rounded min-h-[100px]"
                />
              </div>
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => {
                    setReviewingSubmission(null);
                    setAdminMessage('');
                  }}
                  className="px-4 py-2 bg-secondary text-secondary-foreground rounded hover:bg-secondary/80"
                >
                  Close
                </button>
                <button
                  onClick={() => {
                    if (reviewingSubmission.submission.id) {
                      handleRejectSubmission(reviewingSubmission.submission.id, adminMessage);
                      setReviewingSubmission(null);
                    }
                  }}
                  className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
                >
                  Reject & Send Feedback
                </button>
                <button
                  onClick={() => {
                    if (reviewingSubmission.submission.id) {
                      handleApproveSubmission(reviewingSubmission.submission.id);
                      setReviewingSubmission(null);
                    }
                  }}
                  className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
                >
                  Approve Changes
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Public Themes Section */}
      <div className="mb-8">
        <h2 className="text-2xl font-bold mb-4">Public Themes ({publicThemes.length})</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {publicThemes.map((theme) => (
            <div key={theme.id} className="p-4 border rounded-lg bg-secondary">
              <div className="flex justify-between items-start mb-2">
                <h3 className="text-lg font-bold">{theme.name}</h3>
                <div className="flex gap-2">
                  <span className="px-2 py-1 bg-green-600 text-white text-xs rounded">
                    Public
                  </span>
                  {theme.isDefaultLight && (
                    <span className="px-2 py-1 bg-yellow-600 text-white text-xs rounded">
                      Default Light
                    </span>
                  )}
                  {theme.isDefaultDark && (
                    <span className="px-2 py-1 bg-blue-600 text-white text-xs rounded">
                      Default Dark
                    </span>
                  )}
                  {!theme.isEnabled && (
                    <span className="px-2 py-1 bg-red-600 text-white text-xs rounded">
                      Disabled
                    </span>
                  )}
                  {theme.customCss && (
                    <span className="px-2 py-1 bg-purple-700 text-white text-xs rounded">
                      Advanced CSS
                    </span>
                  )}
                </div>
              </div>

              {theme.createdBy && (
                <p className="text-sm text-muted-foreground mb-2">
                  Created by: {theme.createdBy.username || 'Unknown'}
                </p>
              )}

              <div className="grid grid-cols-4 gap-1 mb-3">
                {Object.entries(theme)
                  .filter(([key]) =>
                    [
                      'background',
                      'foreground',
                      'primary',
                      'secondary',
                      'accent',
                      'muted',
                      'border',
                    ].includes(key)
                  )
                  .map(([key, value]) => (
                    <div
                      key={key}
                      className="w-full h-8 border rounded"
                      style={{ backgroundColor: value as string }}
                      title={key}
                    />
                  ))}
              </div>

              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={() => handleEditTheme(theme)}
                  className="flex-1 px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm"
                >
                  Edit
                </button>
                {!theme.isDefaultLight && !theme.isDefaultDark && (
                  <button
                    onClick={() => handleToggleEnabled(theme.id, theme.isEnabled)}
                    className={`flex-1 px-3 py-1 rounded text-sm ${
                      theme.isEnabled
                        ? 'bg-orange-600 hover:bg-orange-700 text-white'
                        : 'bg-green-600 hover:bg-green-700 text-white'
                    }`}
                  >
                    {theme.isEnabled ? 'Disable' : 'Enable'}
                  </button>
                )}
                {!theme.isDefaultLight && !theme.isDefaultDark && !theme.isEnabled && (
                  <button
                    onClick={() => handleDeleteTheme(theme.id)}
                    className="flex-1 px-3 py-1 bg-red-600 text-white rounded hover:bg-red-700 text-sm"
                  >
                    Delete
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* User Custom Themes Section */}
      {customThemes.length > 0 && (
        <div>
          <h2 className="text-2xl font-bold mb-4">User Custom Themes ({customThemes.length})</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {customThemes.map((theme) => (
              <div key={theme.id} className="p-4 border rounded-lg bg-secondary">
                <div className="flex justify-between items-start mb-2">
                  <h3 className="text-lg font-bold">{theme.name}</h3>
                  <div className="flex gap-2">
                    <span className="px-2 py-1 bg-purple-600 text-white text-xs rounded">
                      Custom
                    </span>
                    {!theme.isEnabled && (
                      <span className="px-2 py-1 bg-red-600 text-white text-xs rounded">
                        Disabled
                      </span>
                    )}
                    {theme.customCss && (
                      <span className="px-2 py-1 bg-purple-700 text-white text-xs rounded">
                        Advanced CSS
                      </span>
                    )}
                  </div>
                </div>

                {theme.createdBy && (
                  <p className="text-sm text-muted-foreground mb-2">
                    Created by: {theme.createdBy.username || 'Unknown'}
                  </p>
                )}

                <div className="grid grid-cols-4 gap-1 mb-3">
                  {Object.entries(theme)
                    .filter(([key]) =>
                      [
                        'background',
                        'foreground',
                        'primary',
                        'secondary',
                        'accent',
                        'muted',
                        'border',
                      ].includes(key)
                    )
                    .map(([key, value]) => (
                      <div
                        key={key}
                        className="w-full h-8 border rounded"
                        style={{ backgroundColor: value as string }}
                        title={key}
                      />
                    ))}
                </div>

                <div className="flex gap-2 flex-wrap">
                  <button
                    onClick={() => handleEditTheme(theme)}
                    className="flex-1 px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDeleteTheme(theme.id)}
                    className="flex-1 px-3 py-1 bg-red-600 text-white rounded hover:bg-red-700 text-sm"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
