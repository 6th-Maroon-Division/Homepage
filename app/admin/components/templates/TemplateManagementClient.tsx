'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useToast } from '@/app/components/ui/ToastContainer';
import ConfirmModal from '@/app/components/ui/ConfirmModal';

interface OrbatTemplate {
  id: number;
  name: string;
  description: string | null;
  category: string | null;
  tagsJson: string | null;
  usageCount: number;
  isActive: boolean;
  createdBy: {
    id: number;
    username: string | null;
    avatarUrl: string | null;
  };
  createdAt: string;
}

interface TemplateManagementClientProps {
  templates: OrbatTemplate[];
}

export default function TemplateManagementClient({ templates: initialTemplates }: TemplateManagementClientProps) {
  const [templates, setTemplates] = useState<OrbatTemplate[]>(initialTemplates);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [templateToDelete, setTemplateToDelete] = useState<OrbatTemplate | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const { showError, showSuccess } = useToast();

  // Get unique categories
  const categories: string[] = ['all', ...Array.from(new Set(templates.map(t => t.category).filter((c): c is string => Boolean(c))))];

  // Filter templates
  const filteredTemplates = templates.filter((template) => {
    // Apply category filter
    if (categoryFilter !== 'all' && template.category !== categoryFilter) {
      return false;
    }

    // Apply search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      return (
        template.name.toLowerCase().includes(query) ||
        template.description?.toLowerCase().includes(query) ||
        template.createdBy.username?.toLowerCase().includes(query) ||
        template.category?.toLowerCase().includes(query)
      );
    }

    return true;
  });

  const handleDelete = async () => {
    if (!templateToDelete) return;

    setIsDeleting(true);
    try {
      const response = await fetch(`/api/templates/${templateToDelete.id}`, {
        method: 'DELETE',
      });

      if (!response.ok) throw new Error('Failed to delete template');

      setTemplates(templates.filter((t) => t.id !== templateToDelete.id));
      showSuccess('Template deleted successfully');
    } catch (error) {
      console.error('Error deleting template:', error);
      showError('Failed to delete template');
    } finally {
      setIsDeleting(false);
      setShowDeleteConfirm(false);
      setTemplateToDelete(null);
    }
  };

  return (
    <>
      {/* Templates Table */}
      <div className="border rounded-lg overflow-hidden" style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)' }}>
        <div className="px-6 py-4 flex justify-between items-center" style={{ borderBottomWidth: '1px', borderColor: 'var(--border)' }}>
          <div>
            <h2 className="text-xl font-semibold" style={{ color: 'var(--foreground)' }}>Templates List</h2>
            <p className="text-sm mt-1" style={{ color: 'var(--muted-foreground)' }}>
              Manage ORBAT templates
            </p>
          </div>
          <Link
            href="/admin/templates/new"
            className="px-4 py-2 rounded-md transition-colors font-medium"
            style={{ backgroundColor: 'var(--primary)', color: 'var(--primary-foreground)' }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'var(--button-hover)';
              e.currentTarget.style.color = 'var(--button-hover-foreground)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'var(--primary)';
              e.currentTarget.style.color = 'var(--primary-foreground)';
            }}
          >
            Create New Template
          </Link>
        </div>

        {/* Filters */}
        <div className="px-6 py-4 flex flex-col sm:flex-row gap-4" style={{ borderBottomWidth: '1px', borderColor: 'var(--border)' }}>
          <div className="flex gap-2">
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setCategoryFilter(cat)}
                className="px-4 py-2 rounded-md font-medium transition-colors whitespace-nowrap"
                style={{
                  backgroundColor: categoryFilter === cat ? 'var(--primary)' : 'var(--muted)',
                  color: categoryFilter === cat ? 'var(--primary-foreground)' : 'var(--foreground)'
                }}
              >
                {cat === 'all' ? 'All' : cat} ({templates.filter(t => cat === 'all' || t.category === cat).length})
              </button>
            ))}
          </div>

          <input
            type="text"
            placeholder="Search templates..."
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

        {filteredTemplates.length === 0 ? (
          <div className="px-6 py-12 text-center" style={{ color: 'var(--muted-foreground)' }}>
            <p>No templates found</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead style={{ backgroundColor: 'var(--muted)' }}>
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--muted-foreground)' }}>
                    Name
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--muted-foreground)' }}>
                    Category
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--muted-foreground)' }}>
                    Created By
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--muted-foreground)' }}>
                    Usage
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--muted-foreground)' }}>
                    Created
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--muted-foreground)' }}>
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredTemplates.map((template, index) => (
                  <tr
                    key={template.id}
                    style={{
                      borderBottomWidth: index !== filteredTemplates.length - 1 ? '1px' : '0px',
                      borderColor: 'var(--border)',
                      backgroundColor: 'var(--secondary)'
                    }}
                  >
                    <td className="px-6 py-4">
                      <Link
                        href={`/admin/templates/${template.id}`}
                        className="font-medium hover:underline"
                        style={{ color: 'var(--primary)' }}
                      >
                        {template.name}
                      </Link>
                      {template.description && (
                        <p className="text-sm mt-1" style={{ color: 'var(--muted-foreground)' }}>
                          {template.description}
                        </p>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      {template.category ? (
                        <span
                          className="px-2 py-1 rounded text-sm font-medium"
                          style={{
                            backgroundColor: 'var(--primary)',
                            color: 'var(--primary-foreground)'
                          }}
                        >
                          {template.category}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--muted-foreground)' }}>—</span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <p style={{ color: 'var(--foreground)' }}>{template.createdBy.username || 'Unknown'}</p>
                    </td>
                    <td className="px-6 py-4">
                      <p style={{ color: 'var(--foreground)' }}>{template.usageCount}</p>
                    </td>
                    <td className="px-6 py-4">
                      <p style={{ color: 'var(--muted-foreground)' }}>
                        {new Date(template.createdAt).toISOString().split('T')[0]}
                      </p>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex gap-2">
                        <Link
                          href={`/admin/templates/${template.id}`}
                          className="px-3 py-1 rounded text-sm font-medium transition-colors"
                          style={{
                            backgroundColor: 'var(--primary)',
                            color: 'var(--primary-foreground)'
                          }}
                        >
                          Edit
                        </Link>
                        <button
                          onClick={() => {
                            setTemplateToDelete(template);
                            setShowDeleteConfirm(true);
                          }}
                          disabled={isDeleting}
                          className="px-3 py-1 rounded text-sm font-medium transition-colors disabled:opacity-50"
                          style={{
                            backgroundColor: '#dc2626',
                            color: 'white'
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ConfirmModal
        isOpen={showDeleteConfirm}
        title="Delete Template"
        message={`Are you sure you want to delete "${templateToDelete?.name}"? This action cannot be undone.`}
        onConfirm={handleDelete}
        onCancel={() => {
          setShowDeleteConfirm(false);
          setTemplateToDelete(null);
        }}
        confirmLabel="Delete"
        isDestructive={true}
      />
    </>
  );
}
