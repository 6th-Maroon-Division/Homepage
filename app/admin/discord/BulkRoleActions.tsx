'use client';
import { useEffect, useState } from 'react';

type Plan = { id: number; action: string; roleIds: string[]; status: string; version: number; memberCount: number; expiresAt: string; nextPage: number | null; page?: { page: number; memberIds: string[]; outcomes: { memberId: string; status: string; errorCode?: string }[] | null } | null };
const box = 'rounded-lg border border-[var(--border)] bg-[var(--secondary)] p-4';
const button = 'rounded border border-[var(--border)] px-3 py-2 text-sm disabled:opacity-50 hover:bg-[var(--accent)]';
async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/discord/bulk-roles${path}`, { cache: 'no-store', ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message ?? 'Bulk role request failed.');
  return result.data;
}
export default function BulkRoleActions() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [selected, setSelected] = useState<Plan | null>(null);
  const [roleId, setRoleId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [reviewed, setReviewed] = useState(false);
  const refresh = async () => { setPlans(await api<Plan[]>('')); };
  useEffect(() => { void api<Plan[]>('').then(setPlans).catch(error => setError(error.message)); }, []);
  const run = async (work: () => Promise<void>) => { setBusy(true); setError(''); setNotice(''); try { await work(); } catch (error) { setError(error instanceof Error ? error.message : 'Request failed.'); } finally { setBusy(false); } };
  const preview = (action: string) => run(async () => {
    const plan = await api<Plan>('', { requestKey: crypto.randomUUID(), action, ...(action === 'remove_menu_role' ? { roleId } : {}) });
    setSelected(plan); setReviewed(false); await refresh(); setNotice('Preview queued. Refresh after the bot reports the affected members. No roles have been changed.');
  });
  const select = (plan: Plan, page = 0) => run(async () => { setSelected(await api<Plan>(`/${plan.id}?page=${page}`)); setReviewed(false); });
  return <section className={box} aria-label="Bulk role changes">
    <h2 className="text-xl font-semibold">Existing members: bulk role changes</h2>
    <p className="mt-2 text-sm text-[var(--muted-foreground)]">Changing default roles only affects future joins. Request a preview to apply defaults to existing members or remove a current or previously configured menu role. Review the affected members before confirming. Previews expire after 15 minutes and configuration changes invalidate them.</p>
    <div className="mt-4 flex flex-wrap gap-3 items-end">
      <button className={button} disabled={busy} onClick={() => void preview('apply_defaults')}>Preview default role assignment</button>
      <label className="grid gap-1 text-sm">Menu role ID<input className="rounded border border-[var(--border)] bg-[var(--background)] p-2" value={roleId} onChange={event => setRoleId(event.target.value)} placeholder="Discord role ID" /></label>
      <button className={button} disabled={busy || !roleId} onClick={() => void preview('remove_menu_role')}>Preview menu role removal</button>
      <button className={button} disabled={busy} onClick={() => void run(refresh)}>Refresh previews</button>
    </div>
    {error && <p role="alert" className="mt-3 text-red-500">{error}</p>}
    {notice && <p role="status" className="mt-3">{notice}</p>}
    <ul className="mt-4 divide-y divide-[var(--border)]">{plans.map(plan => <li key={plan.id} className="py-2 flex flex-wrap items-center justify-between gap-2"><span>#{plan.id} · {plan.action === 'apply_defaults' ? 'Assign default roles' : 'Remove menu role'} · {plan.status} · {plan.memberCount} members</span><button className={button} disabled={busy} onClick={() => void select(plan)}>Review</button></li>)}</ul>
    {selected && <div className="mt-4 border-t border-[var(--border)] pt-4 space-y-3">
      <h3 className="font-semibold">Review #{selected.id} · {selected.status}</h3>
      <p>Roles: {selected.roleIds.join(', ')} · {selected.memberCount} affected members · expires {new Date(selected.expiresAt).toLocaleString()}</p>
      {selected.page && <><p>Page {selected.page.page + 1}: Discord member IDs</p><p className="break-words text-sm">{selected.page.memberIds.join(', ') || 'No affected members.'}</p>{selected.page.outcomes && <ul className="space-y-1 text-sm" aria-label="Member role change outcomes">{selected.page.outcomes.map(outcome => <li key={outcome.memberId}>{outcome.memberId}: {outcome.status}{outcome.errorCode && ` · ${outcome.errorCode}`}</li>)}</ul>}<div className="flex gap-2"><button className={button} disabled={busy || selected.page.page === 0} onClick={() => void select(selected, selected.page!.page - 1)}>Previous</button><button className={button} disabled={busy || selected.nextPage === null} onClick={() => void select(selected, selected.nextPage!)}>Next</button></div></>}
      {selected.status === 'ready' && <><label className="flex gap-2 items-center"><input type="checkbox" checked={reviewed} onChange={event => setReviewed(event.target.checked)} />I have reviewed the affected members and role changes.</label><p className="text-sm text-[var(--muted-foreground)]">Members blocked by a honeypot ban are skipped. The bot checks current membership and role safety again before making changes.</p><button className={button} disabled={busy || !reviewed || !selected.memberCount} onClick={() => void run(async () => { const result = await api<Plan>(`/${selected.id}/confirm`, { version: selected.version, requestKey: crypto.randomUUID() }); setSelected(result); setReviewed(false); await refresh(); setNotice('Reviewed role changes queued for the bot.'); })}>Confirm reviewed changes</button></>}
    </div>}
  </section>;
}
