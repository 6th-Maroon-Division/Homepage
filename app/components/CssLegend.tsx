'use client';

import { useState } from 'react';

export default function CssLegend() {
  const [isExpanded, setIsExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState<'variables' | 'classes' | 'components'>('variables');

  const cssVariables = [
    { name: '--background', description: 'Main background color', usage: 'body, page backgrounds' },
    { name: '--foreground', description: 'Main text color', usage: 'All text content' },
    { name: '--primary', description: 'Primary accent color', usage: 'Buttons, links, highlights' },
    { name: '--primary-foreground', description: 'Text on primary color', usage: 'Button text' },
    { name: '--secondary', description: 'Secondary background', usage: 'Cards, panels, sections' },
    { name: '--secondary-foreground', description: 'Text on secondary', usage: 'Card text' },
    { name: '--accent', description: 'Accent color', usage: 'Highlights, badges, special elements' },
    { name: '--accent-foreground', description: 'Text on accent', usage: 'Badge text' },
    { name: '--muted', description: 'Muted background', usage: 'Disabled states, subtle backgrounds' },
    { name: '--muted-foreground', description: 'Muted text color', usage: 'Placeholder, secondary text' },
    { name: '--border', description: 'Border color', usage: 'All borders, dividers' },
  ];

  const commonClasses = [
    { name: '.top-bar', description: 'Top navigation bar', elements: 'Header navigation' },
    { name: '.user-menu', description: 'User dropdown menu', elements: 'Profile, settings, logout' },
    { name: '.orbat-card', description: 'ORBAT operation cards', elements: 'Operation listings' },
    { name: '.slot-item', description: 'Individual slot in ORBAT', elements: 'Role assignments' },
    { name: '.subslot-item', description: 'Sub-slot items', elements: 'Nested roles' },
    { name: '.calendar-day', description: 'Calendar day cells', elements: 'Date grid' },
    { name: '.modal', description: 'Modal dialogs', elements: 'Popups, confirmations' },
    { name: '.toast', description: 'Toast notifications', elements: 'Success/error messages' },
    { name: '.form-input', description: 'Form input fields', elements: 'Text inputs, textareas' },
    { name: '.btn-primary', description: 'Primary buttons', elements: 'Main action buttons' },
    { name: '.btn-secondary', description: 'Secondary buttons', elements: 'Alternative actions' },
    { name: '.btn-danger', description: 'Danger buttons', elements: 'Delete, remove actions' },
  ];

  const components = [
    { 
      name: 'Top Navigation', 
      selector: 'nav.top-bar',
      description: 'Main navigation bar at the top',
      children: [
        'a (navigation links)',
        'button (user menu trigger)',
        '.user-menu (dropdown)'
      ]
    },
    { 
      name: 'ORBAT List', 
      selector: 'div.orbat-list',
      description: 'List of operations',
      children: [
        '.orbat-card (individual operation)',
        '.orbat-header (title section)',
        '.orbat-details (info section)',
        '.slot-list (roles list)'
      ]
    },
    { 
      name: 'Calendar', 
      selector: 'div.calendar',
      description: 'Calendar view for operations',
      children: [
        '.calendar-header (month/year)',
        '.calendar-grid (day grid)',
        '.calendar-day (individual day)',
        '.calendar-event (operation marker)'
      ]
    },
    { 
      name: 'Slots & Subslots', 
      selector: 'div.slot-container',
      description: 'Role assignment structure',
      children: [
        '.slot-item (main role)',
        '.slot-header (role name)',
        '.subslot-list (nested roles)',
        '.subslot-item (sub-role)',
        '.signup-button (join button)'
      ]
    },
    { 
      name: 'Admin Panel', 
      selector: 'div.admin-panel',
      description: 'Administration interface',
      children: [
        '.admin-nav (admin navigation)',
        '.admin-table (data tables)',
        '.admin-form (edit forms)',
        '.admin-actions (action buttons)'
      ]
    },
    { 
      name: 'Modals', 
      selector: 'div.modal-overlay',
      description: 'Dialog overlays',
      children: [
        '.modal (dialog container)',
        '.modal-header (title)',
        '.modal-content (main content)',
        '.modal-footer (buttons)'
      ]
    },
  ];

  const examples = [
    {
      title: 'Change all button corners',
      code: `button {
  border-radius: 0.25rem;
}`,
    },
    {
      title: 'Custom font family',
      code: `body {
  font-family: 'Your Font', sans-serif;
}`,
    },
    {
      title: 'Style ORBAT cards',
      code: `.orbat-card {
  border: 2px solid var(--primary);
  box-shadow: 0 4px 6px rgba(0,0,0,0.1);
}`,
    },
    {
      title: 'Customize calendar events',
      code: `.calendar-event {
  background: linear-gradient(135deg, var(--primary), var(--accent));
  border-radius: 0.5rem;
}`,
    },
    {
      title: 'Style the top navigation',
      code: `.top-bar {
  backdrop-filter: blur(10px);
  border-bottom: 2px solid var(--primary);
}`,
    },
  ];

  return (
    <div className="border rounded-lg" style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)' }}>
      {/* Collapsible Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-4 py-3 flex items-center justify-between hover:opacity-80 transition-opacity"
        type="button"
      >
        <h3 className="text-lg font-bold" style={{ color: 'var(--foreground)' }}>
          📚 CSS Reference Guide
        </h3>
        <span className="text-xl" style={{ color: 'var(--foreground)' }}>
          {isExpanded ? '−' : '+'}
        </span>
      </button>
      
      {/* Collapsible Content */}
      {isExpanded && (
        <div className="px-4 pb-4 border-t" style={{ borderColor: 'var(--border)' }}>
          {/* Tabs */}
          <div className="flex gap-2 mb-4 mt-4 border-b" style={{ borderColor: 'var(--border)' }}>
        <button
          onClick={() => setActiveTab('variables')}
          className={`px-4 py-2 font-medium transition-colors ${
            activeTab === 'variables' ? 'border-b-2' : ''
          }`}
          style={{
            color: activeTab === 'variables' ? 'var(--primary)' : 'var(--muted-foreground)',
            borderColor: activeTab === 'variables' ? 'var(--primary)' : 'transparent',
          }}
        >
          CSS Variables
        </button>
        <button
          onClick={() => setActiveTab('classes')}
          className={`px-4 py-2 font-medium transition-colors ${
            activeTab === 'classes' ? 'border-b-2' : ''
          }`}
          style={{
            color: activeTab === 'classes' ? 'var(--primary)' : 'var(--muted-foreground)',
            borderColor: activeTab === 'classes' ? 'var(--primary)' : 'transparent',
          }}
        >
          Common Classes
        </button>
        <button
          onClick={() => setActiveTab('components')}
          className={`px-4 py-2 font-medium transition-colors ${
            activeTab === 'components' ? 'border-b-2' : ''
          }`}
          style={{
            color: activeTab === 'components' ? 'var(--primary)' : 'var(--muted-foreground)',
            borderColor: activeTab === 'components' ? 'var(--primary)' : 'transparent',
          }}
        >
          Components
        </button>
      </div>

      {/* Content */}
      <div className="max-h-96 overflow-y-auto">
        {activeTab === 'variables' && (
          <div className="space-y-3">
            <p className="text-sm mb-4" style={{ color: 'var(--muted-foreground)' }}>
              These CSS variables are used throughout the app. Override them in your custom CSS:
            </p>
            {cssVariables.map((variable) => (
              <div key={variable.name} className="p-3 rounded border" style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)' }}>
                <code className="text-sm font-bold" style={{ color: 'var(--accent)' }}>
                  {variable.name}
                </code>
                <p className="text-sm mt-1" style={{ color: 'var(--foreground)' }}>
                  {variable.description}
                </p>
                <p className="text-xs mt-1" style={{ color: 'var(--muted-foreground)' }}>
                  Used in: {variable.usage}
                </p>
              </div>
            ))}
          </div>
        )}

        {activeTab === 'classes' && (
          <div className="space-y-3">
            <p className="text-sm mb-4" style={{ color: 'var(--muted-foreground)' }}>
              Common CSS classes you can target with custom styles:
            </p>
            {commonClasses.map((classItem) => (
              <div key={classItem.name} className="p-3 rounded border" style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)' }}>
                <code className="text-sm font-bold" style={{ color: 'var(--accent)' }}>
                  {classItem.name}
                </code>
                <p className="text-sm mt-1" style={{ color: 'var(--foreground)' }}>
                  {classItem.description}
                </p>
                <p className="text-xs mt-1" style={{ color: 'var(--muted-foreground)' }}>
                  Elements: {classItem.elements}
                </p>
              </div>
            ))}
          </div>
        )}

        {activeTab === 'components' && (
          <div className="space-y-4">
            <p className="text-sm mb-4" style={{ color: 'var(--muted-foreground)' }}>
              Component structure and their child elements:
            </p>
            {components.map((component) => (
              <div key={component.name} className="p-3 rounded border" style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)' }}>
                <div className="font-bold text-sm" style={{ color: 'var(--foreground)' }}>
                  {component.name}
                </div>
                <code className="text-xs" style={{ color: 'var(--accent)' }}>
                  {component.selector}
                </code>
                <p className="text-sm mt-2" style={{ color: 'var(--muted-foreground)' }}>
                  {component.description}
                </p>
                <div className="mt-2 ml-4 space-y-1">
                  {component.children.map((child, idx) => (
                    <div key={idx} className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
                      └ <code style={{ color: 'var(--accent)' }}>{child}</code>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Examples Section */}
      <details className="mt-4 border-t pt-4" style={{ borderColor: 'var(--border)' }}>
        <summary className="cursor-pointer font-bold text-sm mb-3" style={{ color: 'var(--foreground)' }}>
          📝 Example CSS Snippets
        </summary>
        <div className="space-y-3 max-h-64 overflow-y-auto">
          {examples.map((example, idx) => (
            <div key={idx} className="p-3 rounded border" style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)' }}>
              <div className="text-sm font-medium mb-2" style={{ color: 'var(--foreground)' }}>
                {example.title}
              </div>
              <pre className="text-xs p-2 rounded overflow-x-auto" style={{ backgroundColor: 'var(--muted)', color: 'var(--foreground)' }}>
                <code>{example.code}</code>
              </pre>
            </div>
          ))}
        </div>
      </details>
        </div>
      )}
    </div>
  );
}
