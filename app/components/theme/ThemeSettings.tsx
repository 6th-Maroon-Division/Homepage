'use client';

import { useState, useEffect } from 'react';
import { useTheme } from '@/app/components/theme/ThemeProvider';
import CssEditor from '@/app/components/theme/CssEditor';
import CssLegend from '@/app/components/theme/CssLegend';

interface Theme {
  id: number;
  name: string;
  type?: 'original' | 'derived';
  parentThemeId?: number | null;
  isPublic?: boolean;
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
  button?: string;
  buttonHover?: string;
  buttonHoverForeground?: string;
  customCss?: string | null;
  submissions?: Array<{
    id: number;
    status: string;
    message: string | null;
    adminMessage: string | null;
    createdAt: string;
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
  }>;
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

export default function ThemeSettings() {
  const { theme, availableThemes, customThemes, setTheme, refreshThemes } = useTheme();
  const [selectedThemeForDerive, setSelectedThemeForDerive] = useState<Theme | null>(null);
  const [editingTheme, setEditingTheme] = useState<Theme | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [themeData, setThemeData] = useState({
    name: '',
    background: '',
    foreground: '',
    primary: '',
    primaryForeground: '',
    secondary: '',
    secondaryForeground: '',
    accent: '',
    accentForeground: '',
    muted: '',
    mutedForeground: '',
    border: '',
    button: '',
    buttonHover: '',
    buttonHoverForeground: '',
    customCss: '',
  });
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const [submissionMessage, setSubmissionMessage] = useState('');
  const [submissionType, setSubmissionType] = useState<'new' | 'update'>('new');
  const [showNewThemeModal, setShowNewThemeModal] = useState(false);

  // Initialize theme data when editing
  useEffect(() => {
    if (editingTheme) {
      setThemeData({
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
        button: editingTheme.button || '',
        buttonHover: editingTheme.buttonHover || '',
        buttonHoverForeground: editingTheme.buttonHoverForeground || '',
        customCss: editingTheme.customCss || '',
      });
    } else if (selectedThemeForDerive) {
      setThemeData({
        name: `${selectedThemeForDerive.name} (Custom)`,
        background: selectedThemeForDerive.background,
        foreground: selectedThemeForDerive.foreground,
        primary: selectedThemeForDerive.primary,
        primaryForeground: selectedThemeForDerive.primaryForeground,
        secondary: selectedThemeForDerive.secondary,
        secondaryForeground: selectedThemeForDerive.secondaryForeground,
        accent: selectedThemeForDerive.accent,
        accentForeground: selectedThemeForDerive.accentForeground,
        muted: selectedThemeForDerive.muted,
        mutedForeground: selectedThemeForDerive.mutedForeground,
        border: selectedThemeForDerive.border,
        button: selectedThemeForDerive.button || '',
        buttonHover: selectedThemeForDerive.buttonHover || '',
        buttonHoverForeground: selectedThemeForDerive.buttonHoverForeground || '',
        customCss: selectedThemeForDerive.customCss || '',
      });
    }
  }, [editingTheme, selectedThemeForDerive]);

  const handleDeriveTheme = async (publicTheme: Theme) => {
    try {
      const response = await fetch('/api/themes/derive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parentThemeId: publicTheme.id,
          name: `${publicTheme.name} (Custom)`,
        }),
      });

      if (response.ok) {
        const newTheme = await response.json();
        await refreshThemes();
        setEditingTheme(newTheme);
        alert('Theme saved! You can now customize it.');
      } else {
        const error = await response.json();
        alert(`Error: ${error.error}`);
      }
    } catch (error) {
      console.error('Error deriving theme:', error);
      alert('Failed to save theme');
    }
  };

  const handleSaveTheme = async () => {
    try {
      const response = await fetch('/api/themes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingTheme?.id,
          ...themeData,
        }),
      });

      if (response.ok) {
        await refreshThemes();
        alert(editingTheme ? 'Theme updated!' : 'Theme created!');
        setEditingTheme(null);
      } else {
        const error = await response.json();
        alert(`Error: ${error.error}`);
      }
    } catch (error) {
      console.error('Error saving theme:', error);
      alert('Failed to save theme');
    }
  };

  const handleDeleteTheme = async (themeId: number) => {
    if (!confirm('Are you sure you want to delete this theme?')) return;

    try {
      const response = await fetch(`/api/themes?id=${themeId}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        await refreshThemes();
        if (editingTheme?.id === themeId) {
          setEditingTheme(null);
        }
        alert('Theme deleted');
      } else {
        const error = await response.json();
        alert(`Error: ${error.error}`);
      }
    } catch (error) {
      console.error('Error deleting theme:', error);
      alert('Failed to delete theme');
    }
  };

  const handleSubmitChanges = async (submitTheme: Theme) => {
    try {
      const response = await fetch('/api/themes/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          themeId: submitTheme.id,
          message: submissionMessage,
          submissionType: submitTheme.parentThemeId ? submissionType : 'new', // Only relevant for derived themes
          name: themeData.name,
          background: themeData.background,
          foreground: themeData.foreground,
          primary: themeData.primary,
          primaryForeground: themeData.primaryForeground,
          secondary: themeData.secondary,
          secondaryForeground: themeData.secondaryForeground,
          accent: themeData.accent,
          accentForeground: themeData.accentForeground,
          muted: themeData.muted,
          mutedForeground: themeData.mutedForeground,
          border: themeData.border,
          customCss: themeData.customCss,
        }),
      });

      if (response.ok) {
        alert('Changes submitted for review!');
        setShowSubmitModal(false);
        setSubmissionMessage('');
        setSubmissionType('new');
      } else {
        const error = await response.json();
        alert(`Error: ${error.error}`);
      }
    } catch (error) {
      console.error('Error submitting changes:', error);
      alert('Failed to submit changes');
    }
  };

  const handleCreateNewTheme = async () => {
    try {
      const response = await fetch('/api/themes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...themeData,
          type: 'original',
        }),
      });

      if (response.ok) {
        await refreshThemes();
        alert('Theme created! You can now submit it for review to make it public.');
        setShowNewThemeModal(false);
        setThemeData({
          name: '',
          background: '',
          foreground: '',
          primary: '',
          primaryForeground: '',
          secondary: '',
          secondaryForeground: '',
          accent: '',
          accentForeground: '',
          muted: '',
          mutedForeground: '',
          border: '',
          button: '',
          buttonHover: '',
          buttonHoverForeground: '',
          customCss: '',
        });
      } else {
        const error = await response.json();
        alert(`Error: ${error.error}`);
      }
    } catch (error) {
      console.error('Error creating theme:', error);
      alert('Failed to create theme');
    }
  };

  const getParentThemeName = (parentId: number | null | undefined) => {
    if (!parentId) return null;
    const parent = availableThemes.find(t => t.id === parentId);
    return parent?.name;
  };

  return (
    <div className="space-y-6">
      {/* Current Theme */}
      <div className="border rounded-lg p-6" style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)' }}>
        <h2 className="text-xl font-semibold mb-4" style={{ color: 'var(--foreground)' }}>Current Theme</h2>
        <p style={{ color: 'var(--muted-foreground)' }}>
          {theme ? theme.name : 'System Default'}
        </p>
      </div>

      {/* Public Themes */}
      <div className="border rounded-lg p-6" style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)' }}>
        <h2 className="text-xl font-semibold mb-4" style={{ color: 'var(--foreground)' }}>Public Themes</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {availableThemes.map((publicTheme) => (
            <div
              key={publicTheme.id}
              className="p-4 border rounded-lg hover:opacity-80 transition-opacity"
              style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)' }}
            >
              <div className="flex justify-between items-start mb-2">
                <h4 className="font-semibold" style={{ color: 'var(--foreground)' }}>{publicTheme.name}</h4>
                {publicTheme.type === 'derived' && publicTheme.parentThemeId && (
                  <span className="text-xs px-2 py-1 rounded" style={{ backgroundColor: 'var(--accent)', color: 'var(--accent-foreground)' }}>
                    Based on {getParentThemeName(publicTheme.parentThemeId)}
                  </span>
                )}
              </div>
              <div className="flex gap-2 mb-3">
                <div className="w-6 h-6 rounded border" style={{ background: publicTheme.background, borderColor: 'var(--border)' }} title="Background" />
                <div className="w-6 h-6 rounded border" style={{ background: publicTheme.primary, borderColor: 'var(--border)' }} title="Primary" />
                <div className="w-6 h-6 rounded border" style={{ background: publicTheme.accent, borderColor: 'var(--border)' }} title="Accent" />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setTheme(publicTheme.id)}
                  className="px-3 py-1 text-sm rounded hover:opacity-90"
                  style={{ backgroundColor: 'var(--primary)', color: 'var(--primary-foreground)' }}
                >
                  Use Theme
                </button>
                <button
                  onClick={() => handleDeriveTheme(publicTheme)}
                  className="px-3 py-1 text-sm rounded hover:opacity-80"
                  style={{ backgroundColor: 'var(--muted)', color: 'var(--foreground)' }}
                >
                  Save as My Theme
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* User's Custom Themes */}
      {customThemes.length > 0 && (
        <div className="border rounded-lg p-6" style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)' }}>
          <h2 className="text-xl font-semibold mb-4" style={{ color: 'var(--foreground)' }}>My Custom Themes</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {customThemes.map((customTheme) => {
              const latestSubmission = customTheme.submissions?.[0];
              const isRejected = latestSubmission?.status === 'rejected';
              const isPending = latestSubmission?.status === 'pending';
              
              return (
              <div
                key={customTheme.id}
                className="p-4 border rounded-lg"
                style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)' }}
              >
                <div className="flex justify-between items-start mb-2">
                  <h4 className="font-semibold" style={{ color: 'var(--foreground)' }}>{customTheme.name}</h4>
                  {customTheme.parentThemeId && (
                    <span className="text-xs px-2 py-1 rounded" style={{ backgroundColor: 'var(--muted)', color: 'var(--muted-foreground)' }}>
                      Based on {getParentThemeName(customTheme.parentThemeId)}
                    </span>
                  )}
                </div>
                
                {/* Submission Status Messages */}
                {isPending && (
                  <div className="mb-3 p-2 rounded text-xs" style={{ backgroundColor: 'rgba(234, 179, 8, 0.2)', color: '#facc15' }}>
                    ⏳ Pending review
                  </div>
                )}
                {isRejected && latestSubmission.adminMessage && (
                  <div className="mb-3 p-2 rounded text-xs" style={{ backgroundColor: 'rgba(239, 68, 68, 0.2)', color: '#fca5a5' }}>
                    <div className="font-semibold mb-1">❌ Rejected</div>
                    <div>{latestSubmission.adminMessage}</div>
                  </div>
                )}
                
                <div className="flex gap-2 mb-3">
                  <div className="w-6 h-6 rounded border" style={{ background: customTheme.background, borderColor: 'var(--border)' }} />
                  <div className="w-6 h-6 rounded border" style={{ background: customTheme.primary, borderColor: 'var(--border)' }} />
                  <div className="w-6 h-6 rounded border" style={{ background: customTheme.accent, borderColor: 'var(--border)' }} />
                </div>
                <div className="flex gap-2 flex-wrap">
                  <button
                    onClick={() => setTheme(customTheme.id)}
                    className="px-3 py-1 text-sm rounded"
                    style={{ backgroundColor: 'var(--primary)', color: 'var(--primary-foreground)' }}
                  >
                    Use
                  </button>
                  <button
                    onClick={() => setEditingTheme(customTheme)}
                    className="px-3 py-1 text-sm rounded"
                    style={{ backgroundColor: 'var(--muted)', color: 'var(--foreground)' }}
                  >
                    Edit
                  </button>
                  {customTheme.isPublic ? (
                    <span className="px-3 py-1 text-sm rounded" style={{ backgroundColor: 'var(--accent)', color: 'var(--accent-foreground)' }}>
                      Public
                    </span>
                  ) : (
                    <button
                      onClick={() => handleDeleteTheme(customTheme.id)}
                      className="px-3 py-1 text-sm rounded hover:opacity-80"
                      style={{ backgroundColor: 'rgba(239, 68, 68, 0.2)', color: '#fca5a5' }}
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            );
            })}
          </div>
        </div>
      )}

      {/* Create New Theme */}
      <div className="border rounded-lg p-6" style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)' }}>
        <h2 className="text-xl font-semibold mb-4" style={{ color: 'var(--foreground)' }}>Create New Theme</h2>
        <button
          onClick={() => {
            setShowNewThemeModal(true);
            setThemeData({
              name: 'My New Theme',
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
              button: '#3b82f6',
              buttonHover: '#60a5fa',
              buttonHoverForeground: '#ffffff',
              customCss: '',
            });
          }}
          className="px-4 py-2 rounded hover:opacity-90"
          style={{ backgroundColor: 'var(--accent)', color: 'var(--accent-foreground)' }}
        >
          + Create New Theme
        </button>
        <p className="text-sm mt-2" style={{ color: 'var(--muted-foreground)' }}>
          New themes start as private. Submit them for review to make them public.
        </p>
      </div>

      {/* Theme Editor Modal */}
      {(editingTheme || showNewThemeModal) && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto p-6" style={{ backgroundColor: 'var(--background)', borderWidth: '1px', borderColor: 'var(--border)' }}>
              <h3 className="text-xl font-bold mb-4" style={{ color: 'var(--foreground)' }}>
                {editingTheme ? `Edit ${editingTheme.name}` : 'Create New Theme'}
              </h3>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-2" style={{ color: 'var(--foreground)' }}>Theme Name</label>
                  <input
                    type="text"
                    value={themeData.name}
                    onChange={(e) => setThemeData({ ...themeData, name: e.target.value })}
                    className="w-full p-2 border rounded"
                    style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-2" style={{ color: 'var(--foreground)' }}>Background</label>
                    <input
                      type="color"
                      value={themeData.background}
                      onChange={(e) => setThemeData({ ...themeData, background: e.target.value })}
                      className="w-full h-10 rounded"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2" style={{ color: 'var(--foreground)' }}>Foreground</label>
                    <input
                      type="color"
                      value={themeData.foreground}
                      onChange={(e) => setThemeData({ ...themeData, foreground: e.target.value })}
                      className="w-full h-10 rounded"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2" style={{ color: 'var(--foreground)' }}>Primary</label>
                    <input
                      type="color"
                      value={themeData.primary}
                      onChange={(e) => setThemeData({ ...themeData, primary: e.target.value })}
                      className="w-full h-10 rounded"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2" style={{ color: 'var(--foreground)' }}>Primary Foreground</label>
                    <input
                      type="color"
                      value={themeData.primaryForeground}
                      onChange={(e) => setThemeData({ ...themeData, primaryForeground: e.target.value })}
                      className="w-full h-10 rounded"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2" style={{ color: 'var(--foreground)' }}>Secondary</label>
                    <input
                      type="color"
                      value={themeData.secondary}
                      onChange={(e) => setThemeData({ ...themeData, secondary: e.target.value })}
                      className="w-full h-10 rounded"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2" style={{ color: 'var(--foreground)' }}>Secondary Foreground</label>
                    <input
                      type="color"
                      value={themeData.secondaryForeground}
                      onChange={(e) => setThemeData({ ...themeData, secondaryForeground: e.target.value })}
                      className="w-full h-10 rounded"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2" style={{ color: 'var(--foreground)' }}>Accent</label>
                    <input
                      type="color"
                      value={themeData.accent}
                      onChange={(e) => setThemeData({ ...themeData, accent: e.target.value })}
                      className="w-full h-10 rounded"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2" style={{ color: 'var(--foreground)' }}>Accent Foreground</label>
                    <input
                      type="color"
                      value={themeData.accentForeground}
                      onChange={(e) => setThemeData({ ...themeData, accentForeground: e.target.value })}
                      className="w-full h-10 rounded"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2" style={{ color: 'var(--foreground)' }}>Muted</label>
                    <input
                      type="color"
                      value={themeData.muted}
                      onChange={(e) => setThemeData({ ...themeData, muted: e.target.value })}
                      className="w-full h-10 rounded"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2" style={{ color: 'var(--foreground)' }}>Muted Foreground</label>
                    <input
                      type="color"
                      value={themeData.mutedForeground}
                      onChange={(e) => setThemeData({ ...themeData, mutedForeground: e.target.value })}
                      className="w-full h-10 rounded"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2" style={{ color: 'var(--foreground)' }}>Border</label>
                    <input
                      type="color"
                      value={themeData.border}
                      onChange={(e) => setThemeData({ ...themeData, border: e.target.value })}
                      className="w-full h-10 rounded"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2" style={{ color: 'var(--foreground)' }}>Button</label>
                    <input
                      type="color"
                      value={themeData.button}
                      onChange={(e) => setThemeData({ ...themeData, button: e.target.value })}
                      className="w-full h-10 rounded"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2" style={{ color: 'var(--foreground)' }}>Button Hover</label>
                    <input
                      type="color"
                      value={themeData.buttonHover}
                      onChange={(e) => setThemeData({ ...themeData, buttonHover: e.target.value })}
                      className="w-full h-10 rounded"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2" style={{ color: 'var(--foreground)' }}>Button Hover Text</label>
                    <input
                      type="color"
                      value={themeData.buttonHoverForeground}
                      onChange={(e) => setThemeData({ ...themeData, buttonHoverForeground: e.target.value })}
                      className="w-full h-10 rounded"
                    />
                  </div>
                </div>

                <div>
                  <button
                    onClick={() => setShowAdvanced(!showAdvanced)}
                    className="text-sm hover:underline mb-2"
                    style={{ color: 'var(--accent)' }}
                  >
                    {showAdvanced ? '▼' : '▶'} Advanced: Custom CSS
                  </button>
                  {showAdvanced && (
                    <>
                      <CssLegend />
                      <CssEditor
                        value={themeData.customCss}
                        onChange={(value) => setThemeData({ ...themeData, customCss: value || '' })}
                      />
                    </>
                  )}
                </div>

                {/* Submission History */}
                {editingTheme && editingTheme.submissions && editingTheme.submissions.length > 0 && (
                  <div className="border rounded-lg p-4" style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)' }}>
                    <h4 className="font-semibold mb-3" style={{ color: 'var(--foreground)' }}>Submission History</h4>
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
                            <span className="text-xs font-semibold" style={{ color: 'var(--foreground)' }}>
                              {submission.status === 'approved' ? '✅ Approved' : submission.status === 'rejected' ? '❌ Rejected' : '⏳ Pending'}
                            </span>
                            <span className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
                              {new Date(submission.createdAt).toLocaleDateString()} {new Date(submission.createdAt).toLocaleTimeString()}
                            </span>
                          </div>
                          
                          {/* Show changes */}
                          {colorChanges.length > 0 && (
                            <div className="text-xs mb-2 p-2 rounded" style={{ backgroundColor: 'var(--background)' }}>
                              <span className="font-semibold" style={{ color: 'var(--muted-foreground)' }}>Colors changed: </span>
                              <div className="flex flex-wrap gap-1 mt-1">
                                {colorChanges.map(change => (
                                  <div key={change.key} className="flex items-center gap-1 px-1 py-0.5 rounded" style={{ backgroundColor: 'var(--muted)' }}>
                                    <div className="w-3 h-3 rounded border" style={{ backgroundColor: change.newValue, borderColor: 'var(--border)' }} />
                                    <span style={{ color: 'var(--foreground)' }}>{change.key.replace(/([A-Z])/g, ' $1').trim()}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          {cssChanged && (
                            <div className="text-xs mb-2 p-2 rounded" style={{ backgroundColor: 'var(--background)', color: 'var(--muted-foreground)' }}>
                              🎨 Custom CSS modified
                            </div>
                          )}
                          
                          {submission.message && (
                            <div className="text-sm mb-2 p-2 rounded" style={{ backgroundColor: 'var(--background)' }}>
                              <span className="font-semibold" style={{ color: 'var(--muted-foreground)' }}>Your message: </span>
                              <span style={{ color: 'var(--foreground)' }}>{submission.message}</span>
                            </div>
                          )}
                          {submission.adminMessage && (
                            <div className="text-sm p-2 rounded" style={{ backgroundColor: 'var(--background)' }}>
                              <span className="font-semibold" style={{ color: 'var(--muted-foreground)' }}>Admin response: </span>
                              <span style={{ color: 'var(--foreground)' }}>{submission.adminMessage}</span>
                            </div>
                          )}
                        </div>
                      );
                      })}
                    </div>
                  </div>
                )}

                <div className="flex gap-2 justify-end">
                  <button
                    onClick={() => {
                      setEditingTheme(null);
                      setShowNewThemeModal(false);
                    }}
                    className="px-4 py-2 rounded"
                    style={{ backgroundColor: 'var(--secondary)', color: 'var(--foreground)' }}
                  >
                    Cancel
                  </button>
                  {editingTheme && !editingTheme.isPublic && (
                    <button
                      onClick={() => setShowSubmitModal(true)}
                      className="px-4 py-2 rounded"
                      style={{ backgroundColor: 'var(--accent)', color: 'var(--accent-foreground)' }}
                    >
                      Submit for Review
                    </button>
                  )}
                  {editingTheme ? (
                    <button
                      onClick={handleSaveTheme}
                      className="px-4 py-2 rounded"
                      style={{ backgroundColor: 'var(--primary)', color: 'var(--primary-foreground)' }}
                    >
                      Save Changes
                    </button>
                  ) : (
                    <button
                      onClick={handleCreateNewTheme}
                      className="px-4 py-2 rounded"
                      style={{ backgroundColor: 'var(--primary)', color: 'var(--primary-foreground)' }}
                    >
                      Create Theme
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Submit Changes Modal */}
        {showSubmitModal && editingTheme && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-60 p-4">
            <div className="rounded-lg max-w-md w-full p-6" style={{ backgroundColor: 'var(--background)', borderWidth: '1px', borderColor: 'var(--border)' }}>
              <h3 className="text-xl font-bold mb-4" style={{ color: 'var(--foreground)' }}>Submit Theme Changes</h3>
              
              {editingTheme.parentThemeId && editingTheme.parentTheme && (
                <div className="mb-4">
                  <label className="block text-sm font-medium mb-2" style={{ color: 'var(--foreground)' }}>Submission Type</label>
                  <div className="space-y-2">
                    <label className="flex items-center p-3 border rounded cursor-pointer" style={{ borderColor: submissionType === 'new' ? 'var(--primary)' : 'var(--border)', backgroundColor: submissionType === 'new' ? 'var(--primary)/10' : 'transparent' }}>
                      <input
                        type="radio"
                        name="submissionType"
                        value="new"
                        checked={submissionType === 'new'}
                        onChange={(e) => setSubmissionType('new')}
                        className="mr-3"
                      />
                      <div>
                        <div className="font-semibold" style={{ color: 'var(--foreground)' }}>Submit as New Theme</div>
                        <div className="text-xs" style={{ color: 'var(--muted-foreground)' }}>Create a new public theme based on your changes</div>
                      </div>
                    </label>
                    <label className="flex items-center p-3 border rounded cursor-pointer" style={{ borderColor: submissionType === 'update' ? 'var(--primary)' : 'var(--border)', backgroundColor: submissionType === 'update' ? 'var(--primary)/10' : 'transparent' }}>
                      <input
                        type="radio"
                        name="submissionType"
                        value="update"
                        checked={submissionType === 'update'}
                        onChange={(e) => setSubmissionType('update')}
                        className="mr-3"
                      />
                      <div>
                        <div className="font-semibold" style={{ color: 'var(--foreground)' }}>Update Parent Theme</div>
                        <div className="text-xs" style={{ color: 'var(--muted-foreground)' }}>Propose changes to "{editingTheme.parentTheme.name}"</div>
                      </div>
                    </label>
                  </div>
                </div>
              )}
              
              <p className="text-sm mb-4" style={{ color: 'var(--muted-foreground)' }}>
                {editingTheme.parentThemeId && submissionType === 'update' 
                  ? `Submit your changes for admin review. If approved, they will update the "${editingTheme.parentTheme?.name}" theme.`
                  : 'Submit your theme for admin review. If approved, it will become a new public theme.'}
              </p>
              <textarea
                value={submissionMessage}
                onChange={(e) => setSubmissionMessage(e.target.value)}
                placeholder="Describe your changes..."
                className="w-full p-2 border rounded mb-4 min-h-[100px]"
                style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
              />
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => {
                    setShowSubmitModal(false);
                    setSubmissionMessage('');
                    setSubmissionType('new');
                  }}
                  className="px-4 py-2 rounded"
                  style={{ backgroundColor: 'var(--secondary)', color: 'var(--foreground)' }}
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleSubmitChanges(editingTheme)}
                  className="px-4 py-2 rounded"
                  style={{ backgroundColor: 'var(--primary)', color: 'var(--primary-foreground)' }}
                >
                  Submit
                </button>
              </div>
            </div>
          </div>
        )}
    </div>
  );
}
