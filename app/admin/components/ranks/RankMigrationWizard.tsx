// app/admin/components/ranks/RankMigrationWizard.tsx
'use client';

import { useState, useCallback } from 'react';
import { useToast } from '@/app/components/ui/ToastContainer';
import LoadingSpinner from '@/app/components/ui/LoadingSpinner';

type Step = 'confirmation' | 'strategy' | 'mapping' | 'preview' | 'apply';
type Strategy = 'recalculate' | 'grandfather' | 'map';

type Rank = {
  id: number;
  name: string;
  abbreviation: string;
  orderIndex: number;
  attendanceRequiredSinceLastRank: number | null;
  userCount: number;
};

type RankMapping = {
  oldRankId: number;
  newRankId: number;
};

type PreviewChange = {
  userId: number;
  username: string;
  currentRankName: string;
  newRankName: string;
  changeType: 'demotion' | 'promotion' | 'unchanged';
  attendanceSinceLastRank: number;
};

type PreviewResult = {
  totalUsers: number;
  demoted: number;
  promoted: number;
  unchanged: number;
  changes: PreviewChange[];
};

type Props = {
  ranks: Rank[];
};

export default function RankMigrationWizard({ ranks }: Props) {
  const [step, setStep] = useState<Step>('confirmation');
  const [strategy, setStrategy] = useState<Strategy>('grandfather');
  const [rankMappings, setRankMappings] = useState<RankMapping[]>([]);
  const [previewResult, setPreviewResult] = useState<PreviewResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const { showSuccess, showError } = useToast();

  const totalUsers = ranks.reduce((sum, rank) => sum + rank.userCount, 0);

  const handlePreview = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/ranks/migrate/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          strategy,
          rankMappings: strategy === 'map' ? rankMappings : undefined,
        }),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to preview migration');
      }

      const data = await res.json();
      setPreviewResult(data);
      setStep('preview');
    } catch (error) {
      console.error(error);
      showError(error instanceof Error ? error.message : 'Failed to preview migration');
    } finally {
      setLoading(false);
    }
  }, [strategy, rankMappings, showError]);

  const handleApply = async () => {
    if (!confirm('⚠️ WARNING: This will permanently change user ranks. Are you sure you want to proceed?')) {
      return;
    }

    setApplying(true);
    try {
      const res = await fetch('/api/ranks/migrate/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          strategy,
          rankMappings: strategy === 'map' ? rankMappings : undefined,
        }),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to apply migration');
      }

      const data = await res.json();
      showSuccess(
        `Migration complete! Processed: ${data.totalProcessed}, Promoted: ${data.promoted}, Demoted: ${data.demoted}, Unchanged: ${data.unchanged}`
      );

      if (data.errors && data.errors.length > 0) {
        console.warn('Migration errors:', data.errors);
        showError(`${data.errors.length} errors occurred. Check console for details.`);
      }

      setStep('apply');
    } catch (error) {
      console.error(error);
      showError(error instanceof Error ? error.message : 'Failed to apply migration');
    } finally {
      setApplying(false);
    }
  };

  const handleMappingChange = (oldRankId: number, newRankId: number) => {
    setRankMappings((prev) => {
      const existing = prev.find((m) => m.oldRankId === oldRankId);
      if (existing) {
        return prev.map((m) => (m.oldRankId === oldRankId ? { ...m, newRankId } : m));
      }
      return [...prev, { oldRankId, newRankId }];
    });
  };

  const canProceedToPreview = () => {
    if (strategy === 'map') {
      return rankMappings.length > 0;
    }
    return true;
  };

  return (
    <div className="space-y-6">
      {/* Step Indicator */}
      <div className="flex items-center gap-4 overflow-x-auto">
        {[
          { key: 'confirmation', label: 'Confirmation' },
          { key: 'strategy', label: 'Strategy' },
          { key: 'mapping', label: 'Mapping' },
          { key: 'preview', label: 'Preview' },
          { key: 'apply', label: 'Apply' },
        ].map((s, idx) => (
          <div key={s.key} className="flex items-center gap-2">
            <div
              className={`px-4 py-2 rounded-md text-sm font-medium whitespace-nowrap ${
                step === s.key ? 'opacity-100' : 'opacity-50'
              }`}
              style={
                step === s.key
                  ? { backgroundColor: 'var(--primary)', color: 'var(--primary-foreground)' }
                  : { backgroundColor: 'var(--secondary)', color: 'var(--foreground)' }
              }
            >
              {idx + 1}. {s.label}
            </div>
            {idx < 4 && <span style={{ color: 'var(--muted-foreground)' }}>→</span>}
          </div>
        ))}
      </div>

      {/* Step 1: Confirmation */}
      {step === 'confirmation' && (
        <div
          className="border rounded-lg p-6"
          style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)' }}
        >
          <h2 className="text-xl font-semibold mb-4" style={{ color: 'var(--foreground)' }}>
            ⚠️ Important: Backup Your Data
          </h2>

          <div className="space-y-4">
            <div className="p-4 rounded" style={{ backgroundColor: '#ef4444', color: '#ffffff' }}>
              <p className="font-semibold mb-2">WARNING: Data Modification Ahead</p>
              <p className="text-sm">
                This migration wizard will modify user rank data. Please ensure you have a recent database
                backup before proceeding. There is no automatic undo functionality.
              </p>
            </div>

            <div>
              <h3 className="font-semibold mb-2" style={{ color: 'var(--foreground)' }}>
                Current Rank Structure ({totalUsers} users)
              </h3>
              <div className="space-y-2">
                {ranks.map((rank) => (
                  <div
                    key={rank.id}
                    className="flex justify-between items-center p-3 rounded"
                    style={{ backgroundColor: 'var(--background)' }}
                  >
                    <div>
                      <span className="font-medium" style={{ color: 'var(--foreground)' }}>
                        {rank.abbreviation} - {rank.name}
                      </span>
                      <span className="text-xs ml-2" style={{ color: 'var(--muted-foreground)' }}>
                        (Order: {rank.orderIndex})
                      </span>
                    </div>
                    <div className="text-sm" style={{ color: 'var(--muted-foreground)' }}>
                      {rank.userCount} users
                      {rank.attendanceRequiredSinceLastRank && (
                        <span className="ml-2">• {rank.attendanceRequiredSinceLastRank} attendance req.</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setStep('strategy')}
                className="px-4 py-2 rounded-md text-sm font-medium transition-colors"
                style={{ backgroundColor: 'var(--primary)', color: 'var(--primary-foreground)' }}
              >
                I Have a Backup - Proceed
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Step 2: Strategy Selection */}
      {step === 'strategy' && (
        <div
          className="border rounded-lg p-6"
          style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)' }}
        >
          <h2 className="text-xl font-semibold mb-4" style={{ color: 'var(--foreground)' }}>
            Select Migration Strategy
          </h2>

          <div className="space-y-4">
            <label className="flex items-start gap-3 p-4 rounded cursor-pointer hover:opacity-80 transition-opacity"
              style={{ backgroundColor: strategy === 'recalculate' ? 'var(--primary)' : 'var(--background)', 
                       color: strategy === 'recalculate' ? 'var(--primary-foreground)' : 'var(--foreground)' }}>
              <input
                type="radio"
                name="strategy"
                value="recalculate"
                checked={strategy === 'recalculate'}
                onChange={(e) => setStrategy(e.target.value as Strategy)}
                className="mt-1"
              />
              <div>
                <div className="font-semibold">Recalculate Ranks</div>
                <p className="text-sm mt-1" style={{ opacity: 0.9 }}>
                  Recompute all user ranks based on current attendance and rank requirements. Users will be
                  promoted/demoted to match their attendance totals. Use this when rank requirements have changed.
                </p>
              </div>
            </label>

            <label className="flex items-start gap-3 p-4 rounded cursor-pointer hover:opacity-80 transition-opacity"
              style={{ backgroundColor: strategy === 'grandfather' ? 'var(--primary)' : 'var(--background)', 
                       color: strategy === 'grandfather' ? 'var(--primary-foreground)' : 'var(--foreground)' }}>
              <input
                type="radio"
                name="strategy"
                value="grandfather"
                checked={strategy === 'grandfather'}
                onChange={(e) => setStrategy(e.target.value as Strategy)}
                className="mt-1"
              />
              <div>
                <div className="font-semibold">Grandfather (No Changes)</div>
                <p className="text-sm mt-1" style={{ opacity: 0.9 }}>
                  Keep all existing ranks as-is. No users will be promoted or demoted. Use this for testing the
                  migration system or when you only want to update rank metadata.
                </p>
              </div>
            </label>

            <label className="flex items-start gap-3 p-4 rounded cursor-pointer hover:opacity-80 transition-opacity"
              style={{ backgroundColor: strategy === 'map' ? 'var(--primary)' : 'var(--background)', 
                       color: strategy === 'map' ? 'var(--primary-foreground)' : 'var(--foreground)' }}>
              <input
                type="radio"
                name="strategy"
                value="map"
                checked={strategy === 'map'}
                onChange={(e) => setStrategy(e.target.value as Strategy)}
                className="mt-1"
              />
              <div>
                <div className="font-semibold">Map Old Ranks to New Ranks</div>
                <p className="text-sm mt-1" style={{ opacity: 0.9 }}>
                  Map each old rank to a new rank name. Use this when restructuring or renaming ranks. You&apos;ll
                  specify which old rank becomes which new rank in the next step.
                </p>
              </div>
            </label>

            <div className="flex gap-2">
              <button
                onClick={() => setStep('confirmation')}
                className="px-4 py-2 rounded-md text-sm font-medium transition-colors"
                style={{ backgroundColor: 'var(--secondary)', color: 'var(--foreground)' }}
              >
                Back
              </button>
              <button
                onClick={() => setStep(strategy === 'map' ? 'mapping' : 'preview')}
                className="px-4 py-2 rounded-md text-sm font-medium transition-colors"
                style={{ backgroundColor: 'var(--primary)', color: 'var(--primary-foreground)' }}
              >
                {strategy === 'map' ? 'Next: Configure Mappings' : 'Next: Preview Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Step 3: Rank Mapping (only for 'map' strategy) */}
      {step === 'mapping' && strategy === 'map' && (
        <div
          className="border rounded-lg p-6"
          style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)' }}
        >
          <h2 className="text-xl font-semibold mb-4" style={{ color: 'var(--foreground)' }}>
            Map Old Ranks to New Ranks
          </h2>

          <div className="space-y-3">
            {ranks.map((rank) => (
              <div
                key={rank.id}
                className="flex items-center gap-4 p-3 rounded"
                style={{ backgroundColor: 'var(--background)' }}
              >
                <div className="flex-1">
                  <div className="font-medium" style={{ color: 'var(--foreground)' }}>
                    {rank.abbreviation} - {rank.name}
                  </div>
                  <div className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
                    {rank.userCount} users
                  </div>
                </div>
                <span style={{ color: 'var(--muted-foreground)' }}>→</span>
                <select
                  value={rankMappings.find((m) => m.oldRankId === rank.id)?.newRankId || ''}
                  onChange={(e) => handleMappingChange(rank.id, parseInt(e.target.value))}
                  className="px-3 py-2 rounded text-sm"
                  style={{ backgroundColor: 'var(--secondary)', color: 'var(--foreground)' }}
                >
                  <option value="">Select new rank...</option>
                  {ranks.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.abbreviation} - {r.name}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          <div className="mt-6 flex gap-2">
            <button
              onClick={() => setStep('strategy')}
              className="px-4 py-2 rounded-md text-sm font-medium transition-colors"
              style={{ backgroundColor: 'var(--secondary)', color: 'var(--foreground)' }}
            >
              Back
            </button>
            <button
              onClick={handlePreview}
              disabled={!canProceedToPreview() || loading}
              className="px-4 py-2 rounded-md text-sm font-medium transition-colors disabled:opacity-50"
              style={{ backgroundColor: 'var(--primary)', color: 'var(--primary-foreground)' }}
            >
              {loading ? <LoadingSpinner size="sm" /> : 'Next: Preview Changes'}
            </button>
          </div>
        </div>
      )}

      {/* Step 4: Preview */}
      {step === 'preview' && (
        <div
          className="border rounded-lg p-6"
          style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)' }}
        >
          <h2 className="text-xl font-semibold mb-4" style={{ color: 'var(--foreground)' }}>
            Preview Migration Impact
          </h2>

          {!previewResult ? (
            <div className="text-center py-8">
              <button
                onClick={handlePreview}
                disabled={loading}
                className="px-4 py-2 rounded-md text-sm font-medium transition-colors"
                style={{ backgroundColor: 'var(--primary)', color: 'var(--primary-foreground)' }}
              >
                {loading ? <LoadingSpinner size="sm" /> : 'Generate Preview'}
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="p-4 rounded" style={{ backgroundColor: 'var(--background)' }}>
                  <div className="text-2xl font-bold" style={{ color: 'var(--foreground)' }}>
                    {previewResult.totalUsers}
                  </div>
                  <div className="text-sm" style={{ color: 'var(--muted-foreground)' }}>
                    Total Users
                  </div>
                </div>
                <div className="p-4 rounded" style={{ backgroundColor: '#22c55e', color: '#ffffff' }}>
                  <div className="text-2xl font-bold">{previewResult.promoted}</div>
                  <div className="text-sm">Promotions</div>
                </div>
                <div className="p-4 rounded" style={{ backgroundColor: '#ef4444', color: '#ffffff' }}>
                  <div className="text-2xl font-bold">{previewResult.demoted}</div>
                  <div className="text-sm">Demotions</div>
                </div>
                <div className="p-4 rounded" style={{ backgroundColor: 'var(--background)' }}>
                  <div className="text-2xl font-bold" style={{ color: 'var(--foreground)' }}>
                    {previewResult.unchanged}
                  </div>
                  <div className="text-sm" style={{ color: 'var(--muted-foreground)' }}>
                    Unchanged
                  </div>
                </div>
              </div>

              <div>
                <h3 className="font-semibold mb-2" style={{ color: 'var(--foreground)' }}>
                  Detailed Changes
                </h3>
                <div className="max-h-96 overflow-y-auto space-y-2">
                  {previewResult.changes
                    .filter((c) => c.changeType !== 'unchanged')
                    .map((change, idx) => (
                      <div
                        key={idx}
                        className="flex justify-between items-center p-3 rounded"
                        style={{ backgroundColor: 'var(--background)' }}
                      >
                        <div>
                          <span className="font-medium" style={{ color: 'var(--foreground)' }}>
                            {change.username}
                          </span>
                          <span className="text-xs ml-2" style={{ color: 'var(--muted-foreground)' }}>
                            (Attendance: {change.attendanceSinceLastRank})
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span style={{ color: 'var(--foreground)' }}>{change.currentRankName}</span>
                          <span style={{ color: 'var(--muted-foreground)' }}>→</span>
                          <span
                            className="font-medium"
                            style={{
                              color: change.changeType === 'promotion' ? '#22c55e' : '#ef4444',
                            }}
                          >
                            {change.newRankName}
                          </span>
                        </div>
                      </div>
                    ))}
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => setStep(strategy === 'map' ? 'mapping' : 'strategy')}
                  className="px-4 py-2 rounded-md text-sm font-medium transition-colors"
                  style={{ backgroundColor: 'var(--secondary)', color: 'var(--foreground)' }}
                >
                  Back
                </button>
                <button
                  onClick={handleApply}
                  disabled={applying}
                  className="px-4 py-2 rounded-md text-sm font-medium transition-colors disabled:opacity-50"
                  style={{ backgroundColor: '#ef4444', color: '#ffffff' }}
                >
                  {applying ? <LoadingSpinner size="sm" /> : 'Apply Migration'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Step 5: Complete */}
      {step === 'apply' && (
        <div
          className="border rounded-lg p-6"
          style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)' }}
        >
          <h2 className="text-xl font-semibold mb-4" style={{ color: 'var(--foreground)' }}>
            ✅ Migration Complete
          </h2>

          <div className="space-y-4">
            <div className="p-4 rounded" style={{ backgroundColor: '#22c55e', color: '#ffffff' }}>
              <p className="font-semibold mb-2">Migration Applied Successfully</p>
              <p className="text-sm">
                All rank changes have been applied and logged in rank history. Users will see their updated ranks
                immediately.
              </p>
            </div>

            <div>
              <h3 className="font-semibold mb-2" style={{ color: 'var(--foreground)' }}>
                Next Steps
              </h3>
              <ul className="list-disc list-inside space-y-1 text-sm" style={{ color: 'var(--muted-foreground)' }}>
                <li>Review the rank history for each affected user</li>
                <li>Check the pending promotions page for any new proposals</li>
                <li>Notify users of rank changes if necessary</li>
                <li>Monitor for any issues or concerns</li>
              </ul>
            </div>

            <div className="flex gap-2">
              <a
                href="/admin/ranks"
                className="px-4 py-2 rounded-md text-sm font-medium transition-colors inline-block"
                style={{ backgroundColor: 'var(--primary)', color: 'var(--primary-foreground)' }}
              >
                Go to Rank Management
              </a>
              <a
                href="/admin/promotions"
                className="px-4 py-2 rounded-md text-sm font-medium transition-colors inline-block"
                style={{ backgroundColor: 'var(--secondary)', color: 'var(--foreground)' }}
              >
                View Pending Promotions
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
