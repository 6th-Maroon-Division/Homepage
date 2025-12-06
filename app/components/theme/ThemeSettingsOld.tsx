'use client';

import { useState, useEffect } from 'react';
import { useTheme } from '@/app/components/theme/ThemeProvider';
import CssEditor from '@/app/components/theme/CssEditor';
import CssLegend from '@/app/components/theme/CssLegend';

interface Theme {
  id: number;
  name: string;
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
  customCss?: string | null;
}

export default function ThemeSettings() {
  const { theme, availableThemes, customTheme, setTheme, refreshThemes } = useTheme();
  const [showCustomEditor, setShowCustomEditor] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  
  // Get current active theme colors (either selected theme or system default)
  const getCurrentThemeColors = () => {
    if (theme) {
      return {
        background: theme.background,
        foreground: theme.foreground,
        primary: theme.primary,
        primaryForeground: theme.primaryForeground,
        secondary: theme.secondary,
        secondaryForeground: theme.secondaryForeground,
        accent: theme.accent,
        accentForeground: theme.accentForeground,
        muted: theme.muted,
        mutedForeground: theme.mutedForeground,
        border: theme.border,
        customCss: theme.customCss || '',
      };
    }
    
    // Try to get theme from localStorage (includes system default with custom CSS)
    try {
      const savedTheme = localStorage.getItem('theme');
      if (savedTheme) {
        const parsed = JSON.parse(savedTheme);
        return {
          background: parsed.background,
          foreground: parsed.foreground,
          primary: parsed.primary,
          primaryForeground: parsed.primaryForeground,
          secondary: parsed.secondary,
          secondaryForeground: parsed.secondaryForeground,
          accent: parsed.accent,
          accentForeground: parsed.accentForeground,
          muted: parsed.muted,
          mutedForeground: parsed.mutedForeground,
          border: parsed.border,
          customCss: parsed.customCss || '',
        };
      }
    } catch {
      // localStorage might not be available or data corrupted
    }
    
    // Fallback: Get colors from CSS variables (no custom CSS available)
    const root = document.documentElement;
    const computedStyle = getComputedStyle(root);
    return {
      background: computedStyle.getPropertyValue('--background').trim(),
      foreground: computedStyle.getPropertyValue('--foreground').trim(),
      primary: computedStyle.getPropertyValue('--primary').trim(),
      primaryForeground: computedStyle.getPropertyValue('--primary-foreground').trim(),
      secondary: computedStyle.getPropertyValue('--secondary').trim(),
      secondaryForeground: computedStyle.getPropertyValue('--secondary-foreground').trim(),
      accent: computedStyle.getPropertyValue('--accent').trim(),
      accentForeground: computedStyle.getPropertyValue('--accent-foreground').trim(),
      muted: computedStyle.getPropertyValue('--muted').trim(),
      mutedForeground: computedStyle.getPropertyValue('--muted-foreground').trim(),
      border: computedStyle.getPropertyValue('--border').trim(),
      customCss: '',
    };
  };
  
  const [customThemeData, setCustomThemeData] = useState<Partial<Theme>>({
    name: 'My Custom Theme',
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
    customCss: '',
  });
  const [submissionMessage, setSubmissionMessage] = useState('');
  const [submissionStatus, setSubmissionStatus] = useState<string | null>(null);

  // Initialize custom theme data from customTheme prop or current theme
  const initialCustomTheme = customTheme ? {
    name: customTheme.name,
    background: customTheme.background,
    foreground: customTheme.foreground,
    primary: customTheme.primary,
    primaryForeground: customTheme.primaryForeground,
    secondary: customTheme.secondary,
    secondaryForeground: customTheme.secondaryForeground,
    accent: customTheme.accent,
    accentForeground: customTheme.accentForeground,
    muted: customTheme.muted,
    mutedForeground: customTheme.mutedForeground,
    border: customTheme.border,
    customCss: customTheme.customCss || '',
  } : {
    name: 'My Custom Theme',
    ...getCurrentThemeColors(),
  };

  useEffect(() => {
    if (!showCustomEditor) {
      setCustomThemeData(initialCustomTheme);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customTheme, showCustomEditor]);

  const handleThemeSelect = async (themeId: number | null) => {
    await setTheme(themeId);
  };

  const handleSaveCustomTheme = async () => {
    try {
      const response = await fetch('/api/themes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(customThemeData),
      });

      if (response.ok) {
        await refreshThemes();
        alert('Custom theme saved successfully!');
        setShowCustomEditor(false);
      } else {
        const error = await response.json();
        if (error.error?.includes('log out and log back in')) {
          alert('Your session is out of sync. Please log out and log back in to continue.');
        } else {
          alert(error.error || 'Failed to save theme');
        }
      }
    } catch (error) {
      console.error('Error saving custom theme:', error);
      alert('Failed to save custom theme');
    }
  };

  const handleSubmitForReview = async () => {
    if (!customTheme) {
      alert('Please create a custom theme first');
      return;
    }

    try {
      const response = await fetch('/api/themes/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: submissionMessage }),
      });

      if (response.ok) {
        setSubmissionStatus('submitted');
        alert(customTheme.isPublic 
          ? 'Change request submitted for review!' 
          : 'Theme submitted for review!');
        setSubmissionMessage('');
      } else {
        const error = await response.json();
        alert(error.error || 'Failed to submit theme');
      }
    } catch (error) {
      console.error('Error submitting theme:', error);
      alert('Failed to submit theme');
    }
  };

  const handleDeleteCustomTheme = async () => {
    if (!customTheme) return;

    if (customTheme.isPublic) {
      alert('Cannot delete a public theme. You can submit a change request instead.');
      return;
    }

    if (!confirm(`Are you sure you want to delete "${customTheme.name}"? This cannot be undone.`)) {
      return;
    }

    try {
      const response = await fetch('/api/themes', {
        method: 'DELETE',
      });

      if (response.ok) {
        await refreshThemes();
        alert('Custom theme deleted successfully!');
        setShowCustomEditor(false);
      } else {
        const error = await response.json();
        alert(error.error || 'Failed to delete theme');
      }
    } catch (error) {
      console.error('Error deleting custom theme:', error);
      alert('Failed to delete custom theme');
    }
  };

  return (
    <div className="border rounded-lg p-6" style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)' }}>
      <h2 className="text-xl font-semibold mb-4" style={{ color: 'var(--foreground)' }}>Theme Settings</h2>

      <div className="space-y-6">
        {/* Current Theme */}
        <div>
          <label className="block text-sm font-medium mb-2" style={{ color: 'var(--foreground)' }}>
            Current Theme
          </label>
          <p className="text-sm mb-3" style={{ color: 'var(--muted-foreground)' }}>
            {theme ? theme.name : 'System Default'}
          </p>
        </div>

        {/* Available Themes */}
        <div>
          <label className="block text-sm font-medium mb-3" style={{ color: 'var(--foreground)' }}>
            Select Theme
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {/* System Default */}
            <button
              onClick={() => handleThemeSelect(null)}
              className="p-3 border-2 rounded-lg text-left transition-all"
              style={{
                borderColor: !theme ? 'var(--primary)' : 'var(--border)',
                backgroundColor: !theme ? 'var(--primary)' : 'var(--background)',
                color: !theme ? 'var(--primary-foreground)' : 'var(--foreground)'
              }}
            >
              <div className="font-bold">{!theme && '✓ '}System Default</div>
              <div className="text-xs mt-1" style={{ 
                color: !theme ? 'var(--primary-foreground)' : 'var(--muted-foreground)',
                opacity: !theme ? 0.9 : 1
              }}>
                Follows your system preferences
              </div>
            </button>

            {/* Public Themes */}
            {availableThemes.map((t) => (
              <button
                key={t.id}
                onClick={() => handleThemeSelect(t.id)}
                className="p-3 border-2 rounded-lg text-left transition-all"
                style={{
                  borderColor: theme?.id === t.id ? 'var(--primary)' : 'var(--border)',
                  backgroundColor: theme?.id === t.id ? 'var(--primary)' : 'var(--background)',
                  color: theme?.id === t.id ? 'var(--primary-foreground)' : 'var(--foreground)'
                }}
              >
                <div className="font-bold">{theme?.id === t.id && '✓ '}{t.name}</div>
                <div className="flex gap-1 mt-2">
                  {[t.background, t.primary, t.accent, t.foreground].map(
                    (color, idx) => (
                      <div
                        key={idx}
                        className="w-4 h-4 rounded border"
                        style={{ backgroundColor: color, borderColor: 'var(--border)' }}
                      />
                    )
                  )}
                </div>
              </button>
            ))}

            {/* Custom Theme */}
            {customTheme && (
              <button
                onClick={() => handleThemeSelect(customTheme.id)}
                className="p-3 border-2 rounded-lg text-left transition-all"
                style={{
                  borderColor: theme?.id === customTheme.id ? 'var(--primary)' : 'var(--border)',
                  backgroundColor: theme?.id === customTheme.id ? 'var(--primary)' : 'var(--background)',
                  color: theme?.id === customTheme.id ? 'var(--primary-foreground)' : 'var(--foreground)'
                }}
              >
                <div className="font-bold">{theme?.id === customTheme.id && '✓ '}{customTheme.name}</div>
                <div className="text-xs" style={{ 
                  color: theme?.id === customTheme.id ? 'var(--primary-foreground)' : 'var(--muted-foreground)',
                  opacity: theme?.id === customTheme.id ? 0.9 : 1
                }}>Your custom theme</div>
                <div className="flex gap-1 mt-2">
                  {[
                    customTheme.background,
                    customTheme.primary,
                    customTheme.accent,
                    customTheme.foreground,
                  ].map((color, idx) => (
                    <div
                      key={idx}
                      className="w-4 h-4 rounded border"
                      style={{ backgroundColor: color, borderColor: 'var(--border)' }}
                    />
                  ))}
                </div>
              </button>
            )}
          </div>
        </div>

        {/* Custom Theme Editor */}
        <div>
          <button
            onClick={() => setShowCustomEditor(!showCustomEditor)}
            className="px-4 py-2 rounded-md transition-colors"
            style={{ backgroundColor: 'var(--accent)', color: 'var(--accent-foreground)' }}
          >
            {showCustomEditor ? 'Hide' : 'Create/Edit'} Custom Theme
          </button>

          {showCustomEditor && (
            <div className="mt-4 p-4 border rounded-lg space-y-4" style={{ borderColor: 'var(--border)' }}>
              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: 'var(--foreground)' }}>
                  Theme Name
                </label>
                <input
                  type="text"
                  value={customThemeData.name}
                  onChange={(e) =>
                    setCustomThemeData({ ...customThemeData, name: e.target.value })
                  }
                  className="w-full px-3 py-2 border rounded-md"
                  style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
                />
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {Object.entries(customThemeData)
                  .filter(([key]) => key !== 'name' && key !== 'customCss')
                  .map(([key, value]) => (
                    <div key={key}>
                      <label className="block text-xs font-medium mb-1 capitalize" style={{ color: 'var(--foreground)' }}>
                        {key.replace(/([A-Z])/g, ' $1').trim()}
                      </label>
                      <input
                        type="color"
                        value={value as string}
                        onChange={(e) =>
                          setCustomThemeData({
                            ...customThemeData,
                            [key]: e.target.value,
                          })
                        }
                        className="w-full h-10 border rounded cursor-pointer"
                        style={{ borderColor: 'var(--border)' }}
                      />
                    </div>
                  ))}
              </div>

              <div>
                <button
                  type="button"
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  className="px-4 py-2 rounded-md transition-colors mb-2"
                  style={{ backgroundColor: 'var(--accent)', color: 'var(--accent-foreground)' }}
                >
                  {showAdvanced ? 'Hide' : 'Show'} Advanced CSS
                </button>
                
                {showAdvanced && (
                  <div>
                    <label className="block text-sm font-medium mb-2" style={{ color: 'var(--foreground)' }}>
                      Custom CSS (Advanced)
                    </label>
                    <p className="text-sm mb-2" style={{ color: 'var(--muted-foreground)' }}>
                      Add custom CSS to completely override styles. This will be reviewed by admins before becoming public.
                    </p>
                    <div className="mb-4">
                      <CssLegend />
                    </div>
                    <CssEditor
                      value={customThemeData.customCss || ''}
                      onChange={(value) =>
                        setCustomThemeData({ ...customThemeData, customCss: value })
                      }
                      height="300px"
                    />
                  </div>
                )}
              </div>

              <div className="flex gap-2">
                <button
                  onClick={handleSaveCustomTheme}
                  className="px-4 py-2 rounded-md transition-colors"
                  style={{ backgroundColor: 'var(--accent)', color: 'var(--accent-foreground)' }}
                >
                  Save Custom Theme
                </button>

                {customTheme && (
                  <>
                    <button
                      onClick={() => setSubmissionStatus('form')}
                      className="px-4 py-2 rounded-md transition-colors"
                      style={{ backgroundColor: 'var(--primary)', color: 'var(--primary-foreground)' }}
                    >
                      {customTheme.isPublic ? 'Request Change' : 'Submit for Review'}
                    </button>

                    {!customTheme.isPublic && (
                      <button
                        onClick={handleDeleteCustomTheme}
                        className="px-4 py-2 rounded-md transition-colors"
                        style={{ backgroundColor: 'var(--destructive, #ef4444)', color: 'white' }}
                      >
                        Delete Theme
                      </button>
                    )}
                  </>
                )}
              </div>

              {submissionStatus === 'form' && (
                <div className="mt-4 p-4 border rounded-lg space-y-3" style={{ borderColor: 'var(--primary)' }}>
                  <h3 className="font-medium" style={{ color: 'var(--foreground)' }}>
                    {customTheme?.isPublic ? 'Request Theme Changes' : 'Submit Theme for Public Review'}
                  </h3>
                  <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>
                    {customTheme?.isPublic 
                      ? 'Your theme is already public. Submit a change request for admin review.'
                      : 'If approved, your theme (including any custom CSS) will be available to all users.'
                    }
                  </p>
                  {customThemeData.customCss && (
                    <p className="text-sm" style={{ color: 'var(--accent)', fontWeight: 'bold' }}>
                      ⚠️ Note: Your custom CSS will be carefully reviewed by admins for security and compatibility.
                    </p>
                  )}
                  <textarea
                    value={submissionMessage}
                    onChange={(e) => setSubmissionMessage(e.target.value)}
                    placeholder="Optional message for the reviewers..."
                    className="w-full px-3 py-2 border rounded-md"
                    style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
                    rows={3}
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={handleSubmitForReview}
                      className="px-4 py-2 rounded-md transition-colors"
                      style={{ backgroundColor: 'var(--accent)', color: 'var(--accent-foreground)' }}
                    >
                      Submit
                    </button>
                    <button
                      onClick={() => setSubmissionStatus(null)}
                      className="px-4 py-2 rounded-md transition-colors"
                      style={{ backgroundColor: 'var(--secondary)', color: 'var(--foreground)' }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
