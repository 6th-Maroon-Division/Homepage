// app/admin/components/import/LegacyImportClient.tsx
'use client';

import { useState, useEffect, useCallback } from 'react';
import { useToast } from '@/app/components/ui/ToastContainer';
import LoadingSpinner from '@/app/components/ui/LoadingSpinner';

type Step = 'upload' | 'preview' | 'map' | 'apply';

type LegacyRecord = {
  id: number;
  legacyId: string;
  discordUsername: string;
  rankName: string;
  dateJoined: string | null;
  tigSinceLastPromo: number;
  totalTig: number;
  oldData: number;
  isMapped: boolean;
  isApplied: boolean;
  mappedUser: { id: number; username: string } | null;
  notes: string | null;
};

type User = {
  id: number;
  username: string;
};

export default function LegacyImportClient() {
  const [step, setStep] = useState<Step>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [records, setRecords] = useState<LegacyRecord[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [selectedMappings, setSelectedMappings] = useState<Map<number, number>>(new Map());
  const [filterMapped, setFilterMapped] = useState<'all' | 'mapped' | 'unmapped'>('unmapped');
  const { showSuccess, showError } = useToast();

  const fetchRecords = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterMapped === 'mapped') params.set('isMapped', 'true');
      if (filterMapped === 'unmapped') params.set('isMapped', 'false');

      const res = await fetch(`/api/admin/import/legacy-user-data?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to fetch records');

      const data = await res.json();
      setRecords(data.records);
      setUsers(data.users);
    } catch (error) {
      console.error(error);
      showError('Failed to fetch legacy records');
    } finally {
      setLoading(false);
    }
  }, [filterMapped, showError]);

  useEffect(() => {
    if (step === 'preview' || step === 'map') {
      fetchRecords();
    }
  }, [step, fetchRecords]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
    }
  };

  const handleUpload = async () => {
    if (!file) {
      showError('Please select a CSV file');
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch('/api/admin/import/legacy-user-data', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Upload failed');
      }

      const data = await res.json();
      showSuccess(
        `Imported ${data.imported} records. Auto-mapped ${data.autoMapped} users by Discord username.`
      );
      setStep('preview');
    } catch (error) {
      console.error(error);
      showError(error instanceof Error ? error.message : 'Failed to upload CSV');
    } finally {
      setUploading(false);
    }
  };

  const handleMappingChange = (legacyId: number, userId: number) => {
    setSelectedMappings((prev) => {
      const newMap = new Map(prev);
      newMap.set(legacyId, userId);
      return newMap;
    });
  };

  const handleSaveMappings = async () => {
    if (selectedMappings.size === 0) {
      showError('No mappings to save');
      return;
    }

    setLoading(true);
    try {
      const mappings = Array.from(selectedMappings.entries()).map(([legacyId, userId]) => ({
        legacyId,
        userId,
      }));

      const res = await fetch('/api/admin/import/legacy-user-data/map', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mappings }),
      });

      if (!res.ok) throw new Error('Failed to save mappings');

      const data = await res.json();
      showSuccess(`Mapped ${data.mapped} records successfully`);
      setSelectedMappings(new Map());
      fetchRecords();
    } catch (error) {
      console.error(error);
      showError('Failed to save mappings');
    } finally {
      setLoading(false);
    }
  };

  const handleApplyData = async () => {
    if (!confirm('Apply legacy data to user ranks? This will create/update UserRank entries and rank history.')) {
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/admin/import/legacy-user-data/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!res.ok) throw new Error('Failed to apply data');

      const data = await res.json();
      showSuccess(
        `Applied ${data.applied} records successfully. Skipped: ${data.skipped}${data.errors ? '. Check console for errors.' : ''}`
      );

      if (data.errors) {
        console.warn('Apply errors:', data.errors);
      }

      fetchRecords();
    } catch (error) {
      console.error(error);
      showError('Failed to apply legacy data');
    } finally {
      setLoading(false);
    }
  };

  const unmappedCount = records.filter((r) => !r.isMapped).length;
  const unappliedCount = records.filter((r) => r.isMapped && !r.isApplied).length;

  return (
    <div className="space-y-6">
      {/* Step Indicator */}
      <div className="flex items-center gap-4">
        {['upload', 'preview', 'map', 'apply'].map((s, idx) => (
          <div key={s} className="flex items-center gap-2">
            <button
              onClick={() => setStep(s as Step)}
              disabled={s === 'upload' && records.length === 0}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                step === s
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-secondary text-foreground hover:bg-secondary/80'
              }`}
              style={
                step === s
                  ? { backgroundColor: 'var(--primary)', color: 'var(--primary-foreground)' }
                  : { backgroundColor: 'var(--secondary)', color: 'var(--foreground)' }
              }
            >
              {idx + 1}. {s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
            {idx < 3 && <span style={{ color: 'var(--muted-foreground)' }}>→</span>}
          </div>
        ))}
      </div>

      {/* Upload Step */}
      {step === 'upload' && (
        <div
          className="border rounded-lg p-6"
          style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)' }}
        >
          <h2 className="text-xl font-semibold mb-4" style={{ color: 'var(--foreground)' }}>
            Upload CSV File
          </h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2" style={{ color: 'var(--foreground)' }}>
                Select CSV file
              </label>
              <input
                type="file"
                accept=".csv"
                onChange={handleFileChange}
                className="block w-full text-sm"
                style={{ color: 'var(--foreground)' }}
              />
            </div>
            {file && (
              <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>
                Selected: {file.name} ({(file.size / 1024).toFixed(2)} KB)
              </p>
            )}
            <button
              onClick={handleUpload}
              disabled={!file || uploading}
              className="px-4 py-2 rounded-md text-sm font-medium transition-colors disabled:opacity-50"
              style={{ backgroundColor: 'var(--primary)', color: 'var(--primary-foreground)' }}
            >
              {uploading ? <LoadingSpinner size="sm" /> : 'Upload and Parse CSV'}
            </button>
          </div>
          <div className="mt-4 p-4 rounded" style={{ backgroundColor: 'var(--background)' }}>
            <p className="text-sm font-medium mb-2" style={{ color: 'var(--foreground)' }}>
              Expected CSV Format:
            </p>
            <pre className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
              ID,NAME,Rank,Date Joined,TIG Since Last Promo,TOTAL TIG,Old Data
            </pre>
          </div>
        </div>
      )}

      {/* Preview Step */}
      {step === 'preview' && (
        <div
          className="border rounded-lg p-6"
          style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)' }}
        >
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-semibold" style={{ color: 'var(--foreground)' }}>
              Preview Imported Records ({records.length})
            </h2>
            <button
              onClick={fetchRecords}
              className="px-3 py-1 rounded text-sm"
              style={{ backgroundColor: 'var(--background)', color: 'var(--foreground)' }}
            >
              Refresh
            </button>
          </div>

          {loading ? (
            <LoadingSpinner />
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr style={{ borderBottomWidth: '1px', borderColor: 'var(--border)' }}>
                    <th className="px-3 py-2 text-left" style={{ color: 'var(--foreground)' }}>
                      Legacy ID
                    </th>
                    <th className="px-3 py-2 text-left" style={{ color: 'var(--foreground)' }}>
                      Discord Name
                    </th>
                    <th className="px-3 py-2 text-left" style={{ color: 'var(--foreground)' }}>
                      Rank
                    </th>
                    <th className="px-3 py-2 text-left" style={{ color: 'var(--foreground)' }}>
                      Date Joined
                    </th>
                    <th className="px-3 py-2 text-left" style={{ color: 'var(--foreground)' }}>
                      TIG
                    </th>
                    <th className="px-3 py-2 text-left" style={{ color: 'var(--foreground)' }}>
                      Old Data
                    </th>
                    <th className="px-3 py-2 text-left" style={{ color: 'var(--foreground)' }}>
                      Mapped User
                    </th>
                    <th className="px-3 py-2 text-left" style={{ color: 'var(--foreground)' }}>
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((record) => (
                    <tr
                      key={record.id}
                      style={{ borderBottomWidth: '1px', borderColor: 'var(--border)' }}
                    >
                      <td className="px-3 py-2" style={{ color: 'var(--foreground)' }}>
                        {record.legacyId}
                      </td>
                      <td className="px-3 py-2" style={{ color: 'var(--foreground)' }}>
                        {record.discordUsername}
                      </td>
                      <td className="px-3 py-2" style={{ color: 'var(--foreground)' }}>
                        {record.rankName}
                      </td>
                      <td className="px-3 py-2" style={{ color: 'var(--muted-foreground)' }}>
                        {record.dateJoined || 'N/A'}
                      </td>
                      <td className="px-3 py-2" style={{ color: 'var(--foreground)' }}>
                        {record.tigSinceLastPromo}
                      </td>
                      <td className="px-3 py-2" style={{ color: 'var(--foreground)' }}>
                        {record.oldData}
                      </td>
                      <td className="px-3 py-2" style={{ color: 'var(--foreground)' }}>
                        {record.mappedUser?.username || '-'}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className="px-2 py-0.5 rounded text-xs"
                          style={{
                            backgroundColor: record.isApplied
                              ? '#22c55e'
                              : record.isMapped
                                ? '#3b82f6'
                                : '#f59e0b',
                            color: '#ffffff',
                          }}
                        >
                          {record.isApplied ? 'Applied' : record.isMapped ? 'Mapped' : 'Unmapped'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="mt-4 flex gap-2">
            <button
              onClick={() => setStep('map')}
              disabled={unmappedCount === 0}
              className="px-4 py-2 rounded-md text-sm font-medium transition-colors disabled:opacity-50"
              style={{ backgroundColor: 'var(--primary)', color: 'var(--primary-foreground)' }}
            >
              Map Users ({unmappedCount} unmapped)
            </button>
            <button
              onClick={() => setStep('apply')}
              disabled={unappliedCount === 0}
              className="px-4 py-2 rounded-md text-sm font-medium transition-colors disabled:opacity-50"
              style={{ backgroundColor: 'var(--accent)', color: 'var(--accent-foreground)' }}
            >
              Apply Data ({unappliedCount} ready)
            </button>
          </div>
        </div>
      )}

      {/* Map Step */}
      {step === 'map' && (
        <div
          className="border rounded-lg p-6"
          style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)' }}
        >
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-semibold" style={{ color: 'var(--foreground)' }}>
              Map Legacy Users to Current Users
            </h2>
            <div className="flex gap-2">
              <select
                value={filterMapped}
                onChange={(e) => setFilterMapped(e.target.value as typeof filterMapped)}
                className="px-3 py-1 rounded text-sm"
                style={{ backgroundColor: 'var(--background)', color: 'var(--foreground)' }}
              >
                <option value="all">All</option>
                <option value="unmapped">Unmapped Only</option>
                <option value="mapped">Mapped Only</option>
              </select>
              <button
                onClick={fetchRecords}
                className="px-3 py-1 rounded text-sm"
                style={{ backgroundColor: 'var(--background)', color: 'var(--foreground)' }}
              >
                Refresh
              </button>
            </div>
          </div>

          {loading ? (
            <LoadingSpinner />
          ) : (
            <div className="space-y-3">
              {records
                .filter((r) => (filterMapped === 'unmapped' ? !r.isMapped : true))
                .map((record) => (
                  <div
                    key={record.id}
                    className="flex items-center gap-4 p-3 rounded"
                    style={{ backgroundColor: 'var(--background)' }}
                  >
                    <div className="flex-1">
                      <div className="font-medium" style={{ color: 'var(--foreground)' }}>
                        {record.discordUsername} ({record.rankName})
                      </div>
                      <div className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
                        Legacy ID: {record.legacyId} | TIG: {record.tigSinceLastPromo}
                      </div>
                    </div>
                    {record.isMapped ? (
                      <div className="text-sm" style={{ color: 'var(--foreground)' }}>
                        Mapped to: {record.mappedUser?.username}
                      </div>
                    ) : (
                      <select
                        onChange={(e) => handleMappingChange(record.id, parseInt(e.target.value))}
                        className="px-3 py-1 rounded text-sm"
                        style={{ backgroundColor: 'var(--secondary)', color: 'var(--foreground)' }}
                      >
                        <option value="">Select user...</option>
                        {users.map((user) => (
                          <option key={user.id} value={user.id}>
                            {user.username}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                ))}
            </div>
          )}

          {selectedMappings.size > 0 && (
            <button
              onClick={handleSaveMappings}
              disabled={loading}
              className="mt-4 px-4 py-2 rounded-md text-sm font-medium transition-colors"
              style={{ backgroundColor: 'var(--primary)', color: 'var(--primary-foreground)' }}
            >
              Save {selectedMappings.size} Mappings
            </button>
          )}
        </div>
      )}

      {/* Apply Step */}
      {step === 'apply' && (
        <div
          className="border rounded-lg p-6"
          style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)' }}
        >
          <h2 className="text-xl font-semibold mb-4" style={{ color: 'var(--foreground)' }}>
            Apply Legacy Data
          </h2>

          <div className="space-y-4">
            <div className="p-4 rounded" style={{ backgroundColor: 'var(--background)' }}>
              <p className="text-sm" style={{ color: 'var(--foreground)' }}>
                <strong>{unappliedCount}</strong> mapped records ready to apply
              </p>
              <p className="text-xs mt-2" style={{ color: 'var(--muted-foreground)' }}>
                This will create/update UserRank entries and rank history for all mapped users.
              </p>
            </div>

            <button
              onClick={handleApplyData}
              disabled={loading || unappliedCount === 0}
              className="px-4 py-2 rounded-md text-sm font-medium transition-colors disabled:opacity-50"
              style={{ backgroundColor: 'var(--accent)', color: 'var(--accent-foreground)' }}
            >
              {loading ? <LoadingSpinner size="sm" /> : `Apply ${unappliedCount} Records`}
            </button>

            <button
              onClick={() => setStep('preview')}
              className="ml-2 px-4 py-2 rounded-md text-sm font-medium transition-colors"
              style={{ backgroundColor: 'var(--secondary)', color: 'var(--foreground)' }}
            >
              Back to Preview
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
