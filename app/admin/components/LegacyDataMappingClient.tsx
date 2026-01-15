'use client';

import React, { useState } from 'react';
import { useToast } from '@/app/components/ui/ToastContainer';
import LoadingSpinner from '@/app/components/ui/LoadingSpinner';

interface LegacyRecord {
  id: number;
  legacyName: string;
  legacyStatus: string;
  legacyNotes?: string;
  legacyEventDate?: string;
  isMapped: boolean;
  mappedUser?: { id: number; username: string; email: string } | null;
}

interface User {
  id: number;
  username: string;
  email: string;
  avatarUrl: string;
}

export function LegacyDataMappingClient({
  initialData = [],
}: {
  initialData?: LegacyRecord[];
}) {
  const { showToast } = useToast();
  const [activeSubTab, setActiveSubTab] = useState<'all' | 'unmapped' | 'import'>('all');
  const [csvInput, setCsvInput] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [previewRecords, setPreviewRecords] = useState<LegacyRecord[]>([]);
  const [previewMeta, setPreviewMeta] = useState<{ skippedCells?: number; processedCells?: number } | null>(null);
  const [conflicts, setConflicts] = useState<Array<{ legacyUserId: string; legacyEventDate: string; existing: string; new: string }>>([]);
  const [conflictResolutions, setConflictResolutions] = useState<Record<string, string>>({}); // key: "userId_date", value: status choice
  const [legacyData, setLegacyData] = useState<LegacyRecord[]>(initialData);
  const [isFetching, setIsFetching] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [selectedMappingId, setSelectedMappingId] = useState<number | null>(null);
  const [isSavingMapping, setIsSavingMapping] = useState(false);
  const [isFetchingUsers, setIsFetchingUsers] = useState(false);
  const [users, setUsers] = useState<User[]>([]);

  // Load data initially and whenever user views Show All / Unmapped
  React.useEffect(() => {
    fetchLegacyData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    if (activeSubTab !== 'import') {
      fetchLegacyData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSubTab]);

  const handleImportCSV = async () => {
    if (!csvInput.trim()) {
      showToast('Please paste CSV data', 'error');
      return;
    }

    setIsImporting(true);
    try {
      const response = await fetch('/api/attendance/legacy-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csvData: csvInput }),
      });

      const result = await response.json();
      if (response.ok) {
        showToast(`Imported ${result.imported} records - switch to tabs to map users`, 'success');
        setCsvInput('');
        setPreviewRecords([]);
        await fetchLegacyData();
        setActiveSubTab('unmapped');
      } else {
        showToast(result.error || 'Import failed', 'error');
      }
    } catch {
      showToast('Import failed', 'error');
    } finally {
      setIsImporting(false);
    }
  };

  const handlePreviewCSV = async () => {
    if (!csvInput.trim()) {
      showToast('Please paste CSV data', 'error');
      return;
    }

    setIsPreviewing(true);
    try {
      const response = await fetch('/api/attendance/legacy-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csvData: csvInput, previewOnly: true }),
      });

      const result = await response.json();
      if (response.ok) {
        setPreviewRecords(result.preview || []);
        setConflicts(result.conflicts || []);
        setConflictResolutions({}); // Reset conflict choices
        setPreviewMeta({ skippedCells: result.skippedCells, processedCells: result.processedCells });
        
        const message = result.conflicts?.length > 0 
          ? `Preview ready: ${result.imported} records + ${result.conflicts.length} conflicts`
          : `Preview ready: ${result.imported} records (skipping LOA/NO/EO)`;
        showToast(message, 'success');
      } else {
        showToast(result.error || 'Preview failed', 'error');
        setConflicts([]);
      }
    } catch {
      showToast('Preview failed', 'error');
    } finally {
      setIsPreviewing(false);
    }
  };

  const fetchLegacyData = async () => {
    setIsFetching(true);
    try {
      const params = new URLSearchParams({
        ...(searchText && { search: searchText }),
      });

      const response = await fetch(`/api/attendance/legacy-data?${params}`);
      const result = await response.json();
      setLegacyData(result.data || []);
    } catch {
      showToast('Failed to fetch legacy data', 'error');
    } finally {
      setIsFetching(false);
    }
  };

  const handleOpenMapping = async (legacyId: number) => {
    setSelectedMappingId(legacyId);
    await fetchUsers();
  };

  const fetchUsers = async () => {
    setIsFetchingUsers(true);
    try {
      const usersRes = await fetch('/api/users');
      const usersData = await usersRes.json();
      setUsers(usersData);
    } catch {
      showToast('Failed to fetch users', 'error');
    } finally {
      setIsFetchingUsers(false);
    }
  };

  const handleSaveMapping = async (legacyId: number, mappedUserId: number) => {
    setIsSavingMapping(true);
    try {
      const targetRecord = legacyData.find(r => r.id === legacyId);
      if (!targetRecord) {
        showToast('Record not found', 'error');
        return;
      }

      const recordsToUpdate = legacyData.filter(r => r.legacyName === targetRecord.legacyName);

      const updatePromises = recordsToUpdate.map(record => 
        fetch('/api/attendance/legacy-data', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ legacyDataId: record.id, mappedUserId }),
        })
      );

      const responses = await Promise.all(updatePromises);
      const allSuccessful = responses.every(r => r.ok);

      if (allSuccessful) {
        showToast(`User mapping saved for all ${recordsToUpdate.length} records`, 'success');
        setSelectedMappingId(null);
        setSearchText('');
        setActiveSubTab('all');
        await fetchLegacyData();
      } else {
        showToast('Some mappings failed to save', 'error');
      }
    } catch {
      showToast('Save failed', 'error');
    } finally {
      setIsSavingMapping(false);
    }
  };

  const filteredByTab = legacyData.filter((item) => {
    if (activeSubTab === 'unmapped') return !item.isMapped;
    if (activeSubTab === 'all') return true;
    return true;
  });

  const filteredData = filteredByTab.filter((item) =>
    item.legacyName.toLowerCase().includes(searchText.toLowerCase())
  );

  const groupedData = filteredData.reduce((acc, record) => {
    const existing = acc.find(g => g.legacyName === record.legacyName);
    if (existing) {
      existing.records.push(record);
      // Update group status based on all records
      existing.isMapped = existing.records.some(r => r.isMapped);
      existing.mappedUser = existing.records.find(r => r.mappedUser)?.mappedUser || null;
    } else {
      acc.push({
        legacyName: record.legacyName,
        records: [record],
        isMapped: record.isMapped,
        mappedUser: record.mappedUser,
      });
    }
    return acc;
  }, [] as Array<{
    legacyName: string;
    records: LegacyRecord[];
    isMapped: boolean;
    mappedUser?: { id: number; username: string; email: string } | null;
  }>);

  const unmappedCount = legacyData.filter((r) => !r.isMapped).length;
  const mappedCount = legacyData.filter((r) => r.isMapped).length;
  const uniqueUserCount = [...new Set(legacyData.map(r => r.legacyName))].length;
  const uniqueUnmappedCount = [...new Set(legacyData.filter(r => !r.isMapped).map(r => r.legacyName))].length;

  return (
    <div
      style={{
        backgroundColor: 'var(--secondary)',
        borderRadius: '6px',
        border: '1px solid var(--border)',
        padding: '24px',
      }}
      className="space-y-6"
    >
      <div>
        <h3 style={{ color: 'var(--foreground)' }} className="text-lg font-bold mb-4">
          Legacy Attendance Import & User Mapping
        </h3>

        <p className="text-sm mb-4" style={{ color: 'var(--muted-foreground)' }}>
          Import historical attendance records from matrix CSV. Map legacy names to user accounts.
        </p>

        <div className="flex gap-2 mb-4">
          <button
            onClick={() => setActiveSubTab('all')}
            className="px-3 py-1.5 rounded text-sm font-semibold"
            style={{
              backgroundColor: activeSubTab === 'all' ? 'var(--accent)' : 'var(--primary)',
              color: 'var(--foreground)',
              border: '1px solid var(--border)',
            }}
          >
            Show All ({uniqueUserCount})
          </button>
          <button
            onClick={() => setActiveSubTab('unmapped')}
            className="px-3 py-1.5 rounded text-sm font-semibold"
            style={{
              backgroundColor: activeSubTab === 'unmapped' ? 'var(--accent)' : 'var(--primary)',
              color: 'var(--foreground)',
              border: '1px solid var(--border)',
            }}
          >
            Unmapped ({uniqueUnmappedCount})
          </button>
          <button
            onClick={() => setActiveSubTab('import')}
            className="px-3 py-1.5 rounded text-sm font-semibold"
            style={{
              backgroundColor: activeSubTab === 'import' ? 'var(--accent)' : 'var(--primary)',
              color: 'var(--foreground)',
              border: '1px solid var(--border)',
            }}
          >
            Import CSV
          </button>
        </div>

        {activeSubTab === 'import' ? (
          <div className="space-y-4">
            <p style={{ color: 'var(--foreground)' }} className="text-sm font-semibold">
              Import Matrix CSV from Google Sheets
            </p>
            <p style={{ color: 'var(--muted-foreground)' }} className="text-xs">
              Expected format: YEAR: 2025 in headers, then RANK, NAME, ID columns followed by date columns (26-Dec, 2-Jan, etc.)
              <br />
              Status codes imported: P (Operation), A (Absent), NA (Noted Absence)
              <br />
              Note: LOA, NO, and EO are automatically skipped during import.
            </p>

            <textarea
              value={csvInput}
              onChange={(e) => setCsvInput(e.target.value)}
              placeholder="Paste CSV data here..."
              style={{
                backgroundColor: 'var(--primary)',
                color: 'var(--foreground)',
                borderColor: 'var(--border)',
              }}
              className="w-full h-32 border rounded p-2 text-sm font-mono"
            />

            <div className="flex gap-2">
              <button
                onClick={handlePreviewCSV}
                disabled={isPreviewing}
                style={{
                  backgroundColor: isPreviewing ? 'var(--muted-foreground)' : 'var(--primary)',
                  color: 'var(--foreground)',
                }}
                className="px-4 py-2 rounded text-sm font-semibold disabled:opacity-50"
              >
                {isPreviewing ? <LoadingSpinner /> : 'Preview (skip LOA/NO/EO)'}
              </button>
              <button
                onClick={handleImportCSV}
                disabled={isImporting || previewRecords.length === 0 || (conflicts.length > 0 && Object.keys(conflictResolutions).length < conflicts.length)}
                style={{
                  backgroundColor: isImporting ? 'var(--muted-foreground)' : '#10b981',
                  color: 'white',
                }}
                className="px-4 py-2 rounded text-sm font-semibold disabled:opacity-50"
                title={conflicts.length > 0 && Object.keys(conflictResolutions).length < conflicts.length ? 'Resolve all conflicts first' : ''}
              >
                {isImporting ? <LoadingSpinner /> : 'Save to Database'}
              </button>
            </div>

            {previewRecords.length > 0 && (
              <div
                className="space-y-2 border rounded p-3"
                style={{ backgroundColor: 'var(--primary)', borderColor: 'var(--border)' }}
              >
                <p style={{ color: 'var(--foreground)' }} className="text-sm font-semibold">
                  Preview ({previewRecords.length} records) — already skipping LOA/NO/EO
                  {previewMeta?.processedCells !== undefined && (
                    <span className="ml-2 text-xs" style={{ color: 'var(--muted-foreground)' }}>
                      Processed cells: {previewMeta.processedCells} • Skipped: {previewMeta.skippedCells ?? 0}
                    </span>
                  )}
                </p>
                <div className="max-h-48 overflow-y-auto text-xs" style={{ color: 'var(--muted-foreground)' }}>
                  {previewRecords.slice(0, 50).map((r, idx) => (
                    <div key={`${r.legacyName}-${r.legacyEventDate}-${idx}`} className="py-1 border-b border-border last:border-b-0">
                      <span style={{ color: 'var(--foreground)' }} className="font-semibold">{r.legacyName}</span>
                      {' '}• {r.legacyStatus}
                      {r.legacyEventDate && ` • ${new Date(r.legacyEventDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`}
                    </div>
                  ))}
                  {previewRecords.length > 50 && (
                    <p className="mt-2">...and {previewRecords.length - 50} more</p>
                  )}
                </div>
              </div>
            )}

            {conflicts.length > 0 && (
              <div
                className="space-y-3 border rounded p-3"
                style={{ backgroundColor: '#f97316', borderColor: '#ea580c' }}
              >
                <p style={{ color: 'white' }} className="text-sm font-semibold">
                  ⚠️ Conflicts Found: {conflicts.length} records have conflicting statuses
                </p>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {conflicts.map((conflict, idx) => {
                    const key = `${conflict.legacyUserId}_${conflict.legacyEventDate}`;
                    const chosen = conflictResolutions[key];
                    return (
                      <div
                        key={idx}
                        className="p-2 rounded"
                        style={{ backgroundColor: 'rgba(255,255,255,0.1)' }}
                      >
                        <div style={{ color: 'white' }} className="text-xs mb-1">
                          <strong>ID {conflict.legacyUserId}</strong> on {new Date(conflict.legacyEventDate).toLocaleDateString()}
                        </div>
                        <div style={{ color: 'rgba(255,255,255,0.9)' }} className="text-xs space-y-1">
                          <div>Existing: <strong>{conflict.existing}</strong> | New: <strong>{conflict.new}</strong></div>
                          <div className="flex gap-2">
                            <button
                              onClick={() => setConflictResolutions({ ...conflictResolutions, [key]: conflict.existing })}
                              style={{
                                backgroundColor: chosen === conflict.existing ? 'white' : 'rgba(255,255,255,0.2)',
                                color: chosen === conflict.existing ? '#f97316' : 'white',
                              }}
                              className="px-2 py-1 rounded text-xs font-semibold"
                            >
                              Keep {conflict.existing}
                            </button>
                            <button
                              onClick={() => setConflictResolutions({ ...conflictResolutions, [key]: conflict.new })}
                              style={{
                                backgroundColor: chosen === conflict.new ? 'white' : 'rgba(255,255,255,0.2)',
                                color: chosen === conflict.new ? '#f97316' : 'white',
                              }}
                              className="px-2 py-1 rounded text-xs font-semibold"
                            >
                              Use {conflict.new}
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {Object.keys(conflictResolutions).length === conflicts.length && (
                  <p style={{ color: 'rgba(255,255,255,0.8)' }} className="text-xs">
                    ✓ All conflicts resolved
                  </p>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div
              style={{
                backgroundColor: 'var(--primary)',
                padding: '12px',
                borderRadius: '4px',
              }}
              className="text-sm"
            >
              <p style={{ color: 'var(--foreground)' }}>
                {activeSubTab === 'all' 
                  ? `Total: ${legacyData.length} records | Users: ${uniqueUserCount} | Mapped: ${mappedCount} | Unmapped: ${unmappedCount}`
                  : `Unmapped Users: ${uniqueUnmappedCount} (${unmappedCount} records)`
                }
              </p>
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Search by name..."
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                style={{
                  backgroundColor: 'var(--primary)',
                  color: 'var(--foreground)',
                  borderColor: 'var(--border)',
                }}
                className="flex-1 border rounded px-3 py-2 text-sm"
              />
              <button
                onClick={fetchLegacyData}
                style={{
                  backgroundColor: 'var(--primary)',
                  color: 'var(--foreground)',
                  borderColor: 'var(--border)',
                }}
                className="border rounded px-4 py-2 text-sm font-semibold"
              >
                Refresh
              </button>
            </div>

            <div
              style={{
                backgroundColor: 'var(--primary)',
                borderRadius: '4px',
                maxHeight: '400px',
                overflowY: 'auto',
              }}
            >
              {isFetching ? (
                <div className="p-4 text-center">
                  <LoadingSpinner />
                </div>
              ) : groupedData.length === 0 ? (
                <p style={{ color: 'var(--muted-foreground)' }} className="p-4 text-sm text-center">
                  {activeSubTab === 'unmapped' ? 'No unmapped users' : 'No records found'}
                </p>
              ) : (
                <div className="divide-y divide-border">
                  {groupedData.map((group) => (
                    <div
                      key={group.legacyName}
                      style={{ padding: '12px', borderColor: 'var(--border)' }}
                      className="flex justify-between items-center"
                    >
                      <div className="flex-1">
                        <p style={{ color: 'var(--foreground)' }} className="text-sm font-semibold">
                          {group.legacyName}
                        </p>
                        <p style={{ color: 'var(--muted-foreground)' }} className="text-xs">
                          {group.records.length} record{group.records.length > 1 ? 's' : ''} ({group.records.map(r => r.legacyStatus).join(', ')})
                        </p>
                        <p style={{ color: 'var(--muted-foreground)' }} className="text-xs">
                          Dates: {group.records.map(r => 
                            r.legacyEventDate ? new Date(r.legacyEventDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'N/A'
                          ).join(', ')}
                        </p>
                        {group.mappedUser && (
                          <p style={{ color: '#10b981' }} className="text-xs font-semibold">
                            ✓ Mapped to: {group.mappedUser.username || group.mappedUser.email}
                          </p>
                        )}
                      </div>
                      <button
                        onClick={() => handleOpenMapping(group.records[0].id)}
                        style={{
                          backgroundColor: group.isMapped ? '#10b981' : 'var(--muted-foreground)',
                          color: 'white',
                        }}
                        className="px-3 py-1 rounded text-xs font-semibold"
                      >
                        {group.isMapped ? 'Remap' : 'Map'}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {selectedMappingId !== null && (
        <MappingModal
          legacyRecord={legacyData.find((r) => r.id === selectedMappingId)!}
          users={users}
          isFetchingUsers={isFetchingUsers}
          isSavingMapping={isSavingMapping}
          onSave={(userId) => handleSaveMapping(selectedMappingId, userId)}
          onClose={() => setSelectedMappingId(null)}
        />
      )}
    </div>
  );
}

function MappingModal({
  legacyRecord,
  users,
  isFetchingUsers,
  isSavingMapping,
  onSave,
  onClose,
}: {
  legacyRecord: LegacyRecord;
  users: User[];
  isFetchingUsers: boolean;
  isSavingMapping: boolean;
  onSave: (userId: number) => void;
  onClose: () => void;
}) {
  const [selectedUser, setSelectedUser] = useState<number | null>(
    legacyRecord.mappedUser?.id || null
  );
  const [userSearch, setUserSearch] = useState('');

  const filteredUsers = users.filter(
    (u) =>
      u.username?.toLowerCase().includes(userSearch.toLowerCase()) ||
      u.email?.toLowerCase().includes(userSearch.toLowerCase())
  );

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 50,
      }}
      onClick={onClose}
    >
      <div
        style={{
          backgroundColor: 'var(--secondary)',
          border: '1px solid var(--border)',
          borderRadius: '8px',
          padding: '24px',
          maxWidth: '600px',
          width: '90%',
          maxHeight: '80vh',
          overflowY: 'auto',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ color: 'var(--foreground)' }} className="text-lg font-bold mb-4">
          Map: {legacyRecord.legacyName}
        </h3>

        {isFetchingUsers ? (
          <div className="text-center py-8">
            <LoadingSpinner />
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label style={{ color: 'var(--foreground)' }} className="block text-sm font-semibold mb-2">
                Select User Account
              </label>
              <input
                type="text"
                placeholder="Search users..."
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
                style={{
                  backgroundColor: 'var(--primary)',
                  color: 'var(--foreground)',
                  borderColor: 'var(--border)',
                }}
                className="w-full border rounded px-3 py-2 text-sm mb-2"
              />
              <select
                value={selectedUser || ''}
                onChange={(e) => setSelectedUser(e.target.value ? parseInt(e.target.value) : null)}
                style={{
                  backgroundColor: 'var(--primary)',
                  color: 'var(--foreground)',
                  borderColor: 'var(--border)',
                }}
                className="w-full border rounded px-3 py-2 text-sm"
              >
                <option value="">-- Select User --</option>
                {filteredUsers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.username || u.email}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex gap-2 pt-4">
              <button
                onClick={() => onSave(selectedUser!)}
                disabled={!selectedUser || isSavingMapping}
                style={{
                  backgroundColor: selectedUser ? 'var(--primary)' : 'var(--muted-foreground)',
                  color: 'var(--foreground)',
                }}
                className="flex-1 px-4 py-2 rounded font-semibold disabled:opacity-50"
              >
                {isSavingMapping ? <LoadingSpinner /> : 'Save Mapping'}
              </button>
              <button
                onClick={onClose}
                style={{
                  backgroundColor: 'var(--muted-foreground)',
                  color: 'var(--foreground)',
                }}
                className="flex-1 px-4 py-2 rounded font-semibold"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
