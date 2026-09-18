'use client';

import { apiList, apiRequest } from '@/lib/api/client';
import { useMemo, useState } from 'react';
import { useToast } from '@/app/components/ui/ToastContainer';

type PermissionRow = {
  id: number;
  key: string;
  description: string;
  maxValue: number;
};

type PermissionTemplate = {
  id: number;
  name: string;
  description: string | null;
  permissions: Array<{
    permissionId: number;
    key: string;
    value: number;
  }>;
};

type Props = {
  permissions: PermissionRow[];
  templates: PermissionTemplate[];
};

export default function PermissionTemplateManagementClient({ permissions, templates }: Props) {
  const { showError, showSuccess } = useToast();

  const DEFAULT_TEMPLATE_NAME = 'Admin Onboarding Baseline';
  const DEFAULT_TEMPLATE_DESCRIPTION = 'Starter permission profile for newly promoted admin staff.';
  const initialTemplate = templates[0] ?? null;

  const [templateRows, setTemplateRows] = useState<PermissionTemplate[]>(templates);
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(initialTemplate?.id ?? null);
  const [name, setName] = useState(initialTemplate?.name ?? DEFAULT_TEMPLATE_NAME);
  const [description, setDescription] = useState(initialTemplate ? (initialTemplate.description ?? '') : DEFAULT_TEMPLATE_DESCRIPTION);
  const [expandedPermissionGroups, setExpandedPermissionGroups] = useState<Record<string, boolean>>(() => {
    const groups = Array.from(new Set(permissions.map((permission) => permission.key.split(':')[0] || 'other')));
    return Object.fromEntries(groups.map((group) => [group, false]));
  });
  const [permissionValues, setPermissionValues] = useState<Record<number, number>>(() => {
    const selected = templates[0];
    if (!selected) return {};
    return Object.fromEntries(selected.permissions.map((p) => [p.permissionId, p.value]));
  });

  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const groupedPermissions = useMemo(() => {
    const map = new Map<string, PermissionRow[]>();
    for (const permission of permissions) {
      const group = permission.key.split(':')[0] || 'other';
      const rows = map.get(group) ?? [];
      rows.push(permission);
      map.set(group, rows);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [permissions]);

  const loadTemplateIntoEditor = (templateId: number | null, rows = templateRows) => {
    if (templateId === null) {
      setSelectedTemplateId(null);
      setName(DEFAULT_TEMPLATE_NAME);
      setDescription(DEFAULT_TEMPLATE_DESCRIPTION);
      setPermissionValues({});
      return;
    }

    const selected = rows.find((template) => template.id === templateId);
    if (!selected) {
      return;
    }

    setSelectedTemplateId(selected.id);
    setName(selected.name);
    setDescription(selected.description ?? '');
    setPermissionValues(Object.fromEntries(selected.permissions.map((p) => [p.permissionId, p.value])));
  };

  const templatePayload = permissions.map((permission) => ({
    permissionId: permission.id,
    value: permissionValues[permission.id] ?? 0,
  }));

  const refreshTemplates = async () => {
    const nextTemplates = (await apiList<PermissionTemplate>('/api/permissions/templates')).sort((a, b) => a.name.localeCompare(b.name));
    setTemplateRows(nextTemplates);
    return nextTemplates;
  };

  const handleSave = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      showError('Template name is required');
      return;
    }

    setIsSaving(true);
    try {
      await apiRequest<PermissionTemplate>(selectedTemplateId === null ? '/api/permissions/templates' : `/api/permissions/templates/${selectedTemplateId}`, {
        method: selectedTemplateId === null ? 'POST' : 'PATCH',
        body: JSON.stringify({ name: trimmedName, description: description.trim() || null, permissions: templatePayload }),
      });

      const nextTemplates = await refreshTemplates();
      const matching = nextTemplates.find((template) => template.name === trimmedName);
      if (matching) {
        loadTemplateIntoEditor(matching.id, nextTemplates);
      }
      showSuccess('Permission template saved');
    } catch (error) {
      showError(error instanceof Error ? error.message : 'Failed to save template');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (selectedTemplateId === null) {
      return;
    }

    const selected = templateRows.find((template) => template.id === selectedTemplateId);
    if (!selected) {
      return;
    }

    const confirmed = window.confirm(`Delete template \"${selected.name}\"?`);
    if (!confirmed) {
      return;
    }

    setIsDeleting(true);
    try {
      await apiRequest(`/api/permissions/templates/${selectedTemplateId}`, { method: 'DELETE' });

      const nextTemplates = await refreshTemplates();
      if (nextTemplates.length > 0) {
        loadTemplateIntoEditor(nextTemplates[0].id, nextTemplates);
      } else {
        loadTemplateIntoEditor(null);
      }
      showSuccess('Permission template deleted');
    } catch (error) {
      showError(error instanceof Error ? error.message : 'Failed to delete template');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-lg border p-4" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--secondary)' }}>
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="w-full md:max-w-sm">
            <label className="block text-xs mb-1" style={{ color: 'var(--muted-foreground)' }}>
              Existing Templates
            </label>
            <select
              value={selectedTemplateId ?? 0}
              onChange={(event) => {
                const value = Number(event.target.value);
                if (value === 0) {
                  loadTemplateIntoEditor(null);
                } else {
                  loadTemplateIntoEditor(value);
                }
              }}
              className="w-full px-3 py-2 rounded border text-sm"
              style={{ borderColor: 'var(--border)', backgroundColor: 'var(--background)', color: 'var(--foreground)' }}
            >
              <option value={0}>+ New template</option>
              {templateRows.map((template) => (
                <option key={template.id} value={template.id}>{template.name}</option>
              ))}
            </select>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => loadTemplateIntoEditor(null)}
              className="px-3 py-2 rounded text-sm font-medium"
              style={{ backgroundColor: 'var(--muted)', color: 'var(--foreground)' }}
            >
              New
            </button>
            <button
              type="button"
              onClick={() => void handleDelete()}
              disabled={selectedTemplateId === null || isDeleting}
              className="px-3 py-2 rounded text-sm font-medium disabled:opacity-50"
              style={{ backgroundColor: 'var(--destructive)', color: 'var(--destructive-foreground)' }}
            >
              {isDeleting ? 'Deleting…' : 'Delete'}
            </button>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={isSaving}
              className="px-3 py-2 rounded text-sm font-medium disabled:opacity-50"
              style={{ backgroundColor: 'var(--primary)', color: 'var(--primary-foreground)' }}
            >
              {isSaving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>

      <div className="rounded-lg border p-4 space-y-4" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--secondary)' }}>
        <h2 className="font-semibold" style={{ color: 'var(--foreground)' }}>Template Details</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs mb-1" style={{ color: 'var(--muted-foreground)' }}>Template Name</label>
            <input
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="w-full px-3 py-2 rounded border text-sm"
              style={{ borderColor: 'var(--border)', backgroundColor: 'var(--background)', color: 'var(--foreground)' }}
            />
          </div>
          <div>
            <label className="block text-xs mb-1" style={{ color: 'var(--muted-foreground)' }}>Description</label>
            <input
              type="text"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              className="w-full px-3 py-2 rounded border text-sm"
              style={{ borderColor: 'var(--border)', backgroundColor: 'var(--background)', color: 'var(--foreground)' }}
            />
          </div>
        </div>
      </div>

      <div className="rounded-lg border p-4 space-y-3" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--secondary)' }}>
        <h2 className="font-semibold" style={{ color: 'var(--foreground)' }}>Permission Values</h2>
        {groupedPermissions.map(([group, rows]) => {
          const isExpanded = expandedPermissionGroups[group] ?? false;
          return (
          <div key={group} className="rounded border" style={{ borderColor: 'var(--border)' }}>
            <button
              type="button"
              onClick={() => {
                setExpandedPermissionGroups((prev) => ({
                  ...prev,
                  [group]: !isExpanded,
                }));
              }}
              className="w-full px-3 py-2 flex items-center justify-between text-left"
              style={{ backgroundColor: 'var(--muted)', color: 'var(--foreground)' }}
            >
              <span className="text-sm font-medium">{group}</span>
              <span className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
                {rows.length} • {isExpanded ? 'Hide' : 'Show'}
              </span>
            </button>
            {isExpanded && <div className="p-2 space-y-2">
              {rows.map((permission) => (
                <div key={permission.id} className="rounded border p-2 flex items-center justify-between gap-2" style={{ borderColor: 'var(--border)' }}>
                  <div>
                    <div className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>{permission.key}</div>
                    <div className="text-xs" style={{ color: 'var(--muted-foreground)' }}>{permission.description}</div>
                  </div>
                  <input
                    type="number"
                    min={0}
                    max={permission.maxValue}
                    value={permissionValues[permission.id] ?? 0}
                    onChange={(event) => {
                      const raw = Number(event.target.value);
                      const bounded = Number.isFinite(raw)
                        ? Math.max(0, Math.min(permission.maxValue, Math.trunc(raw)))
                        : 0;
                      setPermissionValues((prev) => ({ ...prev, [permission.id]: bounded }));
                    }}
                    className="w-24 px-2 py-1 rounded border text-sm"
                    style={{ borderColor: 'var(--border)', backgroundColor: 'var(--background)', color: 'var(--foreground)' }}
                  />
                </div>
              ))}
            </div>}
          </div>
        );})}
      </div>
    </div>
  );
}
