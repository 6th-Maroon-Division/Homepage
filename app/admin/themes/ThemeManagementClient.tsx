'use client';

import { useState, useEffect } from 'react';
import CssEditor from '@/app/components/CssEditor';
import CssLegend from '@/app/components/CssLegend';

interface Theme {
  id: number;
  name: string;
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
  submissions?: Array<{
    id: number;
    status: string;
    message: string | null;
    createdAt: string;
    submittedBy: {
      id: number;
      username: string | null;
    };
  }>;
}

export default function ThemeManagementClient() {
  const [themes, setThemes] = useState<Theme[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingTheme, setEditingTheme] = useState<Theme | null>(null);
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

  const handleRejectSubmission = async (submissionId: number) => {
    try {
      const response = await fetch(
        `/api/themes/admin/submissions/${submissionId}/reject`,
        { method: 'POST' }
      );

      if (response.ok) {
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
                    <div>
                      <h3 className="text-lg font-bold">{theme.name}</h3>
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
                        onClick={() => handleApproveSubmission(pendingSub.id)}
                        className="px-3 py-1 bg-green-600 text-white rounded hover:bg-green-700 text-sm"
                      >
                        Approve
                      </button>
                      <button
                        onClick={() => handleRejectSubmission(pendingSub.id)}
                        className="px-3 py-1 bg-red-600 text-white rounded hover:bg-red-700 text-sm"
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
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
