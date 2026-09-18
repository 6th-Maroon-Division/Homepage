'use client';

import { useState } from 'react';
import { apiRequest } from '@/lib/api/client';
import { useToast } from '@/app/components/ui/ToastContainer';
import LoadingSpinner from '@/app/components/ui/LoadingSpinner';

interface ImportResult {
  imported: number;
  skipped: number;
  total: number;
}

export default function AttendanceImportClient({ orbatId }: { orbatId: number }) {
  const [csvData, setCsvData] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const { showToast } = useToast();

  const handleImport = async () => {
    if (!csvData.trim()) {
      showToast('Please paste CSV data', 'error');
      return;
    }

    setIsImporting(true);
    try {
      // Calendar dates in this import are UTC dates.
      const lines = csvData.trim().split('\n');
      const records = [];

      for (const line of lines) {
        if (!line.trim()) continue;
        const cells = line.split(',').map(s => s.trim());
        if (cells.join(',').toLowerCase() === 'username,date,status') continue;
        const [username, date, status] = cells;
        if (cells.length !== 3 || !username || !date || !status) throw new Error('Each row must contain username,date,status.');
        records.push({ username, date, status: status.toUpperCase() });
      }

      if (records.length === 0) {
        showToast('No valid records found in CSV', 'error');
        setIsImporting(false);
        return;
      }

      if (records.length > 100) throw new Error('Import at most 100 rows at a time.');
      const { data } = await apiRequest<ImportResult>(`/api/orbats/${orbatId}/attendance/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ records }),
      });
      setResult(data);
      showToast(
        `Imported ${data.imported} records, skipped ${data.skipped}`,
        data.imported > 0 ? 'success' : 'warning'
      );
      setCsvData('');
    } catch (error) {
      console.error('Error importing:', error);
      showToast(error instanceof Error ? error.message : 'Failed to import attendance records', 'error');
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="border rounded-lg overflow-hidden" style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)' }}>
      <div className="px-6 py-4" style={{ borderBottomWidth: '1px', borderColor: 'var(--border)' }}>
        <h2 className="text-xl font-semibold mb-1" style={{ color: 'var(--foreground)' }}>
          Import Legacy Attendance Data
        </h2>
        <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>
          Import up to 100 rows for this operation. Dates use UTC. A failed import saves no rows.
        </p>
      </div>

      <div className="px-6 py-6 space-y-4">
        <div>
          <h3 className="font-semibold mb-2" style={{ color: 'var(--foreground)' }}>CSV Format</h3>
          <div
            className="p-4 rounded-md text-sm font-mono mb-4"
            style={{ backgroundColor: 'var(--background)', color: 'var(--muted-foreground)' }}
          >
            <p>username,date,status</p>
            <p>JohnDoe,2026-01-15,P</p>
            <p>JaneSmith,2026-01-15,A</p>
            <p>BobJones,2026-01-15,NA</p>
          </div>

          <h3 className="font-semibold mb-2" style={{ color: 'var(--foreground)' }}>Status Codes</h3>
          <div className="space-y-1 text-sm mb-4">
            <div style={{ color: 'var(--foreground)' }}>
              <span className="font-medium">P</span> - Present (Operation attended)
            </div>
            <div style={{ color: 'var(--foreground)' }}>
              <span className="font-medium">A</span> - Absent (Did not attend)
            </div>
            <div style={{ color: 'var(--foreground)' }}>
              <span className="font-medium">NA</span> - Noted Absence (Marked as absent)
            </div>
            <div style={{ color: 'var(--foreground)' }}>
              <span className="font-medium">LOA</span> - Leave of Absence (Marked as absent)
            </div>
            <div style={{ color: 'var(--muted-foreground)' }}>
              <span className="font-medium">NO</span> - No Operation (Skipped)
            </div>
            <div style={{ color: 'var(--muted-foreground)' }}>
              <span className="font-medium">EO</span> - Event Operation (Skipped)
            </div>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium mb-2" style={{ color: 'var(--foreground)' }}>
            CSV Data
          </label>
          <textarea
            value={csvData}
            onChange={(e) => setCsvData(e.target.value)}
            placeholder="Paste CSV data here..."
            rows={8}
            className="w-full border rounded-md px-3 py-2"
            style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
          />
        </div>

        <button
          onClick={handleImport}
          disabled={isImporting || !csvData.trim()}
          className="w-full px-4 py-2 rounded-md transition-colors font-medium disabled:opacity-50"
          style={{
            backgroundColor: 'var(--primary)',
            color: 'var(--primary-foreground)',
          }}
        >
          {isImporting ? (
            <div className="flex items-center justify-center gap-2">
              <LoadingSpinner />
              Importing...
            </div>
          ) : (
            'Import Records'
          )}
        </button>

        {result && (
          <div
            className="p-4 rounded-md border"
            style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)' }}
          >
            <h3 className="font-semibold mb-2" style={{ color: 'var(--foreground)' }}>
              Import Result
            </h3>
            <div className="space-y-1 text-sm">
              <div style={{ color: 'var(--foreground)' }}>
                <span className="font-medium">Total:</span> {result.total}
              </div>
              <div className="text-green-600">
                <span className="font-medium">Imported:</span> {result.imported}
              </div>
              <div className="text-yellow-600">
                <span className="font-medium">Skipped:</span> {result.skipped}
              </div>

            </div>
          </div>
        )}
      </div>
    </div>
  );
}
