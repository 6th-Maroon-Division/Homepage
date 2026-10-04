'use client';

import Link from 'next/link';
import BulkRoleActions from './BulkRoleActions';
import type { Diagnostics } from '@/lib/discord/diagnostics';
import { useCallback, useEffect, useState } from 'react';
import { apiRequest } from '@/lib/api/client';
import { CONFIG_FIELDS, DEFAULT_RETENTION, defaultSettings, parseSettings, type DiscordSettings, type Retention, type RoleMenu } from '@/lib/discord/config';

type Choice = { id: string; name: string };
type Configuration = { updatedAt?: string | null; metadataObservedAt?: string | null; diagnosticsReportedAt?: string | null; diagnostics?: Diagnostics | null; revision: number; appliedRevision: number | null; settings: DiscordSettings; retention?: Retention; metadata?: { roles: Choice[]; channels: Choice[] } | null; lastSeenAt?: string | null; health?: string | null; botVersion?: string | null };
type Command = { id: string; kind: string; status: string; errorCode: string | null; createdAt: string; result?: unknown };
type ConfigRevision = { id: number; revision: number; settings: DiscordSettings; createdAt: string };
type Operation = { id: number; kind: string; status: string; attempts: number; memberId: string | null; errorCode: string | null; occurredAt: string };
type Case = { id: string; memberId: string; action: string; status: string; timeoutUntil: string | null; releasedAt: string | null; occurredAt: string; cleanup?: unknown };
type Evidence = { id: string; caseId: string; messageId: string; authorId: string; content: string; capturedAt: string; expiresAt: string | null; indefinite: boolean; deletedAt: string | null; recoverUntil: string | null; version: number; attachments: { name: string; contentType: string; dataBase64: string }[] };
const panel = 'rounded-lg border border-[var(--border)] bg-[var(--secondary)] p-5';
const box = `${panel} space-y-4`;
const input = 'w-full rounded border border-[var(--border)] bg-[var(--background)] px-3 py-2 disabled:opacity-60';
const button = 'rounded border border-[var(--border)] px-3 py-2 text-sm hover:bg-[var(--accent)] disabled:opacity-50 disabled:cursor-not-allowed';
const date = (value?: string | null) => value ? new Date(value).toLocaleString() : '—';

function IdInput({ value, onChange, choices, label, disabled }: { value: string; onChange: (value: string) => void; choices: Choice[]; label: string; disabled?: boolean }) {
  return <label className="block space-y-1"><span className="text-sm">{label}</span>{choices.length ? <select className={input} value={value} disabled={disabled} onChange={e => onChange(e.target.value)}><option value="">Select…</option>{value && !choices.some(c => c.id === value) && <option value={value}>{value} (not in latest inventory)</option>}{choices.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select> : <input className={input} value={value} disabled={disabled} placeholder="Discord ID" onChange={e => onChange(e.target.value)} />}</label>;
}

export default function DiscordAdminClient({ permissions, defaultWebsiteUrl = '' }: { permissions: Record<string, boolean>; defaultWebsiteUrl?: string }) {
  const can = (action: string) => !!permissions[`discord:${action}`];
  const [config, setConfig] = useState<Configuration | null>(null);
  const [settings, setSettings] = useState<DiscordSettings>(defaultSettings);
  const [retention, setRetention] = useState<Retention>(DEFAULT_RETENTION);
  const [dirty, setDirty] = useState(false);
  const [idDrafts, setIdDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [tab, setTab] = useState('configuration');
  const [commands, setCommands] = useState<Command[]>([]);
  const [history, setHistory] = useState<ConfigRevision[]>([]);
  const [operations, setOperations] = useState<Operation[]>([]);
  const [cases, setCases] = useState<Case[]>([]);
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [evidenceState, setEvidenceState] = useState('active');
  const [caseFilter, setCaseFilter] = useState('');
  const roles = config?.metadata?.roles ?? [];
  const channels = config?.metadata?.channels ?? [];
  const configure = can('configure');
  const loadConfig = useCallback(async () => {
    const { data } = await apiRequest<Configuration>('/api/discord/config', { cache: 'no-store' });
    const prefillWebsiteUrl = !data.settings.websiteUrl && !!defaultWebsiteUrl;
    setNow(Date.now()); setConfig(data); setSettings(prefillWebsiteUrl ? { ...data.settings, websiteUrl: defaultWebsiteUrl } : data.settings); setIdDrafts({}); setRetention(data.retention ?? DEFAULT_RETENTION); setDirty(prefillWebsiteUrl);
  }, [defaultWebsiteUrl]);
  useEffect(() => {
    const start = setTimeout(() => { void loadConfig().catch(e => setError(e.message)).finally(() => setLoading(false)); }, 0);
    const timer = setInterval(() => setNow(Date.now()), 15000);
    return () => { clearTimeout(start); clearInterval(timer); };
  }, [loadConfig]);
  const loadRows = useCallback(async (section: string, next?: string) => {
    const params = new URLSearchParams({ limit: '25' });
    if (next) params.set('cursor', next);
    if (section === 'evidence') { params.set('state', evidenceState); if (caseFilter) params.set('caseId', caseFilter); }
    if (section === 'activity') {
      const { data, meta } = await apiRequest<Command[]>(`/api/discord/commands?${params}`); setCommands(old => next ? [...old, ...data] : data); setCursor(meta.nextCursor ?? null);
    } else if (section === 'history') {
      const { data, meta } = await apiRequest<ConfigRevision[]>(`/api/discord/config/history?${params}`); setHistory(old => next ? [...old, ...data] : data); setCursor(meta.nextCursor ?? null);
    } else if (section === 'operations') {
      const { data, meta } = await apiRequest<Operation[]>(`/api/discord/operations?${params}`); setOperations(old => next ? [...old, ...data] : data); setCursor(meta.nextCursor ?? null);
    } else if (section === 'moderation') {
      const { data, meta } = await apiRequest<Case[]>(`/api/discord/cases?${params}`); setCases(old => next ? [...old, ...data] : data); setCursor(meta.nextCursor ?? null);
    } else if (section === 'evidence') {
      const { data, meta } = await apiRequest<Evidence[]>(`/api/discord/evidence?${params}`); setEvidence(old => next ? [...old, ...data] : data); setCursor(meta.nextCursor ?? null);
    }
  }, [caseFilter, evidenceState]);
  useEffect(() => {
    const timer = setTimeout(() => { setCursor(null); if (tab !== 'configuration' && tab !== 'bulk') { setBusy(true); void loadRows(tab).catch(e => setError(e.message)).finally(() => setBusy(false)); } }, 0);
    return () => clearTimeout(timer);
  }, [tab, loadRows]);
  const run = async (work: () => Promise<void>) => { setBusy(true); setError(''); setNotice(''); try { await work(); } catch (e) { setError(e instanceof Error ? e.message : 'Request failed.'); } finally { setBusy(false); } };
  const update = (key: string, value: DiscordSettings[string]) => { setSettings(old => ({ ...old, [key]: value })); setDirty(true); };
  const updateMenu = (index: number, patch: Partial<RoleMenu>) => update('menus', settings.menus.map((menu, i) => i === index ? { ...menu, ...patch } : menu));
  const save = () => run(async () => {
    const parsed = parseSettings(settings); if (!parsed.data) throw new Error(parsed.error);
    await apiRequest('/api/discord/config', { method: 'PUT', body: JSON.stringify({ revision: config?.revision, settings }) });
    await loadConfig(); setNotice('Configuration saved. The bot must apply the new revision before it takes effect.');
  });
  const queue = (kind: string, payload: object = {}) => run(async () => {
    await apiRequest('/api/discord/commands', { method: 'POST', body: JSON.stringify({ requestKey: crypto.randomUUID(), kind, payload }) });
    setNotice('Action queued. Check Activity for delivery and completion.');
  });
  const evidenceAction = (item: Evidence, action: 'delete' | 'restore' | 'indefinite') => {
    if (action === 'delete' && !window.confirm('Delete this evidence? It can be restored for seven days before permanent removal.')) return;
    void run(async () => {
      await apiRequest(`/api/discord/evidence/${item.id}`, { method: 'PATCH', body: JSON.stringify({ version: item.version, action }) });
      await loadRows('evidence'); setNotice(`Evidence ${action === 'indefinite' ? 'marked for indefinite retention' : action === 'restore' ? 'restored' : 'deleted with a seven-day recovery window'}.`);
    });
  };
  const download = (attachment: Evidence['attachments'][number]) => {
    const bytes = Uint8Array.from(atob(attachment.dataBase64), c => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
    const link = document.createElement('a'); link.href = url; link.download = attachment.name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <main className="mx-auto max-w-6xl px-4 py-8 space-y-6">
    <header className={`${panel} flex flex-wrap items-start justify-between gap-4`}><div><Link href="/admin" className="text-sm underline">Administration</Link><h1 className="text-3xl font-bold mt-2">Discord bot</h1><p className="text-[var(--muted-foreground)] mt-2">Configure the server, manage delivery, and review moderation.</p></div><button className={button} disabled={busy || loading} onClick={() => { if (!dirty || window.confirm('Discard unsaved configuration changes and refresh?')) void run(async () => { await loadConfig(); if (tab !== 'configuration') await loadRows(tab); }); }}>Refresh</button></header>
    {error && <p role="alert" className="rounded border border-red-500 bg-[var(--secondary)] p-3 text-red-500">{error}</p>}{notice && <p role="status" className="rounded border border-emerald-500 bg-[var(--secondary)] p-3">{notice}</p>}
    {loading ? <p className={panel}>Loading Discord settings…</p> : !config ? <p className={panel}>Configuration could not be loaded. Use Refresh to try again.</p> : <>
      <section className={`${box} grid gap-4 sm:grid-cols-4`} aria-label="Bot status"><div><p className="text-sm opacity-70">Connection</p><strong>{config.lastSeenAt && now - Date.parse(config.lastSeenAt) < Number(settings.heartbeatSeconds) * 3000 ? 'Connected' : 'No recent contact'}</strong></div><div><p className="text-sm opacity-70">Configuration</p><strong>{config.appliedRevision === config.revision ? `Applied · revision ${config.revision}` : `Saved · revision ${config.revision}, waiting for bot`}</strong></div><div><p className="text-sm opacity-70">Last contact</p>{date(config.lastSeenAt)}</div><div><p className="text-sm opacity-70">Bot version</p>{config.botVersion ?? 'Not reported'}</div></section>
      <nav className={`${panel} flex flex-wrap gap-2`} aria-label="Discord administration sections">{[['configuration', 'Configuration', true], ['activity', 'Activity', can('view') || can('retry') || configure || can('announce')], ['bulk', 'Bulk roles', configure], ['history', 'Configuration history', configure], ['operations', 'Bot reports', can('view') || configure], ['moderation', 'Moderation', can('moderation_view') || can('timeout_release') || can('evidence_view')], ['evidence', 'Evidence', can('evidence_view')]].filter(([, , visible]) => visible).map(([id, label]) => <button key={String(id)} className={`${button} ${tab === id ? 'font-bold bg-[var(--background)]' : ''}`} aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(String(id))}>{label}</button>)}</nav>
      {tab === 'bulk' && configure && <BulkRoleActions />}
      {tab === 'history' && <section className={box}><h2 className="text-lg font-semibold">Configuration history</h2><p className="text-sm opacity-80">Saved behavioral settings by revision. Evidence retention is managed separately.</p>{!history.length && <p>No saved revisions recorded.</p>}{history.map(item => <details key={item.id} className="border-t border-[var(--border)] pt-3"><summary className="cursor-pointer">Revision {item.revision} · {date(item.createdAt)}</summary><pre className="overflow-auto whitespace-pre-wrap text-xs mt-3">{JSON.stringify(item.settings, null, 2)}</pre></details>)}</section>}
      {tab === 'configuration' && <div className="space-y-5">
        {(!configure || !roles.length) && <div className={box}>
          {!configure && <p>You have read-only access to general configuration.</p>}
          {!roles.length && <p className="text-sm text-[var(--muted-foreground)]">Role and channel selectors populate when the bot reports its server inventory. Until then, enter Discord IDs.</p>}
        </div>}
        <section className={box}><h2 className="text-lg font-semibold">Bot diagnostics</h2><p className="text-sm">Inventory observed: {date(config.metadataObservedAt)}{(!config.metadataObservedAt || now - Date.parse(config.metadataObservedAt) > Number(settings.freshnessSeconds) * 1000) && ' · Stale or not reported'}</p>{config.diagnostics ? <><p className="text-sm">Reported {date(config.diagnosticsReportedAt)} · Configuration revision {config.diagnostics.configRevision}{config.diagnostics.configRevision !== config.revision && ' (older configuration)'} · {config.diagnostics.pendingCount} pending · {config.diagnostics.failedCount} failed</p>{!config.diagnostics.supportedSchemaVersions.includes(1) && <p role="alert" className="text-red-500">The bot does not support this configuration schema. Update the bot before applying settings.</p>}{!config.diagnostics.issues.length && <p>No configuration issues reported.</p>}<ul className="space-y-2">{config.diagnostics.issues.map((issue, index) => <li key={index} className={issue.severity === 'error' ? 'text-red-500' : ''}>{issue.severity}: {issue.code}{issue.field && ` · ${issue.field}`}{issue.resourceId && ` · ${issue.resourceId}`}</li>)}</ul><details><summary className="cursor-pointer">Discord permissions and capabilities</summary><ul className="mt-2 space-y-1">{config.diagnostics.permissions.map(permission => <li key={permission.capability}>{permission.capability}: {permission.granted ? 'Available' : 'Missing'}</li>)}</ul></details></> : <p>The bot has not reported diagnostics yet.</p>}</section>
        {Array.from(new Set(CONFIG_FIELDS.map(f => f.group))).map(group => <details className={box} key={group} open={group === 'Connection'}><summary className="cursor-pointer text-lg font-semibold">{group}</summary>
          {group === 'Connection' && <p className="text-sm opacity-80">The Discord server ID identifies your server. The public website URL is used for links in Discord messages and defaults to this website’s configured address. Save configuration to apply it. The bot’s API URL and credentials are configured in its local deployment.</p>}
          {group === 'Joining' && <p className="text-sm opacity-80">Default roles apply to future joins. Three attempts total; failed assignments appear in Bot reports.</p>}
          {group === 'Honeypot' && <p className="text-sm opacity-80">Exemptions take priority. Configured membership roles receive a timeout; everyone else is banned. Reaction roles never establish membership. Cleanup covers the preceding 30 minutes and preserves evidence.</p>}
          {group === 'Rank and name sync' && <p><Link className="underline" href="/admin/ranks">Manage rank-to-Discord-role mappings</Link>. Website names win on first linking; clearing a nickname restores the formatted website name.</p>}
          {group === 'Operations' && <p className="text-sm opacity-80">Website API credentials, Discord API credentials, and the outage-alert recipient are configured in the separate bot deployment.</p>}
          <fieldset disabled={!configure || busy} className="grid gap-4 md:grid-cols-2">{CONFIG_FIELDS.filter(f => f.group === group).map(field => {
            const value = settings[field.key];
            if (field.type === 'boolean') return <label className="flex items-center gap-3 py-2" key={field.key}><input type="checkbox" checked={!!value} onChange={e => update(field.key, e.target.checked)} />{field.label}</label>;
            if (field.type === 'id') return <IdInput key={field.key} label={field.label} value={String(value)} onChange={v => update(field.key, v)} choices={field.key === 'guildId' ? [] : field.key.toLowerCase().includes('role') ? roles : channels} />;
            if (field.type === 'ids' && !field.key.includes('User') && roles.length) return <label key={field.key} className="space-y-1"><span className="text-sm">{field.label}</span><select multiple className={`${input} min-h-32`} value={value as string[]} onChange={e => update(field.key, Array.from(e.target.selectedOptions, option => option.value))}>{[...roles, ...(value as string[]).filter(id => !roles.some(r => r.id === id)).map(id => ({ id, name: `${id} (not in latest inventory)` }))].map(role => <option key={role.id} value={role.id}>{role.name}</option>)}</select><span className="text-xs opacity-70">Use Ctrl / Cmd to select multiple roles.</span></label>;
            return <label key={field.key} className={`block space-y-1 ${field.type === 'textarea' ? 'md:col-span-2' : ''}`}><span className="text-sm">{field.label}</span>{field.type === 'textarea' ? <textarea rows={4} className={input} value={String(value)} onChange={e => update(field.key, e.target.value)} /> : <input className={input} type={field.type === 'number' ? 'number' : field.type === 'color' ? 'color' : field.type === 'url' ? 'url' : 'text'} min={field.min} max={field.max} value={field.type === 'ids' ? (idDrafts[field.key] ?? (value as string[]).join(', ')) : String(value)} placeholder={field.type === 'ids' ? 'Comma-separated Discord IDs' : undefined} onChange={e => { if (field.type === 'ids') setIdDrafts(old => ({ ...old, [field.key]: e.target.value })); update(field.key, field.type === 'number' ? Number(e.target.value) : field.type === 'ids' ? e.target.value.split(/[\s,]+/).filter(Boolean) : e.target.value); }} />}</label>;
          })}</fieldset>
          {group === 'Welcome' && <><p className="text-xs opacity-70">Placeholders: {'{member}, {server}, {recruiter_role}, {recruit_lobby}, {guidebook_url}, {rules_channel}'}</p><pre className="whitespace-pre-wrap rounded bg-[var(--background)] p-3 text-sm">{String(settings.welcomeTemplate)}</pre>{configure && <button className={button} disabled={busy || dirty || !settings.welcomeEnabled} onClick={() => queue('welcome.test')}>Queue test welcome</button>}</>}
          {group === 'Rank and name sync' && configure && <button className={button} disabled={busy || dirty} onClick={() => { if (window.confirm('Queue reconciliation of configured rank roles and nicknames for linked members?')) queue('sync.all'); }}>Queue synchronization</button>}
        </details>)}
        <section className={box}><div className="flex justify-between gap-3"><h2 className="text-lg font-semibold">Reaction role categories</h2>{configure && <button className={button} disabled={busy || settings.menus.length >= 25} onClick={() => update('menus', [...settings.menus, { id: crypto.randomUUID(), title: 'New category', description: 'React to give yourself a role.', channelId: '', singleChoice: false, entries: [{ emoji: '', label: '', roleId: '' }] }])}>Add category</button>}</div><p className="text-sm opacity-80">Removing a reaction removes its mapped role. Deleting a category or entry keeps previously assigned roles. Save changes before publishing.</p>
          {!settings.menus.length && <p>No role categories configured.</p>}
          {settings.menus.map((menu, index) => <fieldset key={menu.id} disabled={!configure || busy} className="rounded border border-[var(--border)] p-4 space-y-3"><legend className="px-2 font-semibold">{menu.title}</legend><div className="grid md:grid-cols-2 gap-3"><label className="space-y-1">Title<input className={input} value={menu.title} onChange={e => updateMenu(index, { title: e.target.value })} /></label><IdInput label="Destination channel" choices={channels} value={menu.channelId} onChange={v => updateMenu(index, { channelId: v })} /></div><label className="block">Description<textarea className={input} value={menu.description} onChange={e => updateMenu(index, { description: e.target.value })} /></label><label className="flex gap-2"><input type="checkbox" checked={menu.singleChoice} onChange={e => updateMenu(index, { singleChoice: e.target.checked })} />Allow only one selection in this category</label>
            {menu.entries.map((entry, entryIndex) => <div key={entryIndex} className="grid gap-2 md:grid-cols-[100px_1fr_1fr_auto] items-end"><label className="text-sm">Emoji<input className={input} value={entry.emoji} onChange={e => updateMenu(index, { entries: menu.entries.map((item, i) => i === entryIndex ? { ...item, emoji: e.target.value } : item) })} /></label><label className="text-sm">Display label<input className={input} value={entry.label} onChange={e => updateMenu(index, { entries: menu.entries.map((item, i) => i === entryIndex ? { ...item, label: e.target.value } : item) })} /></label><IdInput label="Discord role" choices={roles} value={entry.roleId} onChange={v => updateMenu(index, { entries: menu.entries.map((item, i) => i === entryIndex ? { ...item, roleId: v } : item) })} /><div className="flex gap-1"><button className={button} aria-label={`Move ${entry.label || 'entry'} up`} disabled={!entryIndex} onClick={() => { const entries = [...menu.entries]; [entries[entryIndex - 1], entries[entryIndex]] = [entries[entryIndex], entries[entryIndex - 1]]; updateMenu(index, { entries }); }}>↑</button><button className={button} onClick={() => updateMenu(index, { entries: menu.entries.filter((_, i) => i !== entryIndex) })}>Remove</button></div></div>)}
            <div className="flex flex-wrap gap-2"><button className={button} disabled={menu.entries.length >= 20} onClick={() => updateMenu(index, { entries: [...menu.entries, { emoji: '', label: '', roleId: '' }] })}>Add role</button><button className={button} disabled={dirty} onClick={() => queue('menu.publish', { menuId: menu.id })}>Queue publish / update</button><button className={button} onClick={() => { if (window.confirm('Remove this category from configuration? Existing member roles will be kept.')) update('menus', settings.menus.filter((_, i) => i !== index)); }}>Delete category</button></div>
            <div className="rounded bg-[var(--background)] p-3"><strong>Role Menu: {menu.title}</strong><p className="whitespace-pre-wrap">{menu.description}</p>{menu.entries.map((entry, i) => <p key={i}>{entry.emoji} : {entry.label}</p>)}</div>
          </fieldset>)}
        </section>
        {configure && <div className="sticky bottom-3 rounded-lg border border-[var(--border)] bg-[var(--background)] p-4 flex flex-wrap items-center gap-4"><button className={`${button} font-semibold`} disabled={busy || !dirty} onClick={save}>Save configuration</button><span className="text-sm">{dirty ? 'Unsaved changes. Publishing uses the saved configuration.' : 'No unsaved changes.'}</span></div>}
        {config.retention && <section className={box}><h2 className="text-lg font-semibold">Evidence retention</h2><p className="text-sm opacity-80">At least seven days. Shorter policies apply only to new evidence; longer policies extend existing evidence. Automatic and manual deletion both allow seven days for recovery. Indefinite evidence can still be deleted manually.</p><fieldset disabled={!can('evidence_retention') || busy} className="flex flex-wrap items-end gap-4"><label>Retention<select className={input} value={retention.mode} onChange={e => setRetention(e.target.value === 'indefinite' ? { mode: 'indefinite', days: null } : { mode: 'days', days: 7 })}><option value="days">Number of days</option><option value="indefinite">Keep indefinitely</option></select></label>{retention.mode === 'days' && <label>Days<input className={input} type="number" min={7} max={36500} value={retention.days ?? 7} onChange={e => setRetention({ mode: 'days', days: Number(e.target.value) })} /></label>}{can('evidence_retention') && <button className={button} disabled={dirty} onClick={() => run(async () => { await apiRequest('/api/discord/retention', { method: 'PATCH', body: JSON.stringify({ revision: config.revision, retention }) }); await loadConfig(); setNotice('Evidence retention updated.'); })}>Save retention policy</button>}</fieldset>{dirty && <p className="text-sm">Save general configuration before changing retention.</p>}</section>}
        <p className={`${panel} text-sm text-[var(--muted-foreground)]`}>Mod preset integration and full ORBAT cancellation are planned for a later release.</p>
      </div>}
      {tab === 'activity' && <section className={box}><h2 className="text-lg font-semibold">Action delivery</h2><p className="text-sm opacity-80">Queued means waiting for the bot, not completed.</p>{!commands.length && <p>No actions recorded.</p>}{commands.map(command => <article className="border-t border-[var(--border)] pt-3" key={command.id}><div className="flex flex-wrap justify-between gap-3"><div><strong>{command.kind}</strong> · {command.status}<p className="text-sm opacity-70">{date(command.createdAt)}</p>{command.errorCode && <p className="text-red-500">{command.errorCode}</p>}</div>{can('retry') && command.status === 'failed' && <button className={button} disabled={busy} onClick={() => run(async () => { await apiRequest(`/api/discord/commands/${command.id}/retry`, { method: 'POST', body: '{}' }); await loadRows('activity'); setNotice('Retry queued.'); })}>Retry</button>}</div></article>)}</section>}
      {tab === 'operations' && <section className={box}><h2 className="text-lg font-semibold">Automatic bot operations</h2><p className="text-sm opacity-80">Reported outcomes for join roles, welcomes, reaction roles, and rank/name synchronization.</p>{!operations.length && <p>No bot reports recorded.</p>}{operations.map(operation => <article className="border-t border-[var(--border)] pt-3 space-y-1" key={operation.id}><p><strong>{operation.kind}</strong> · {operation.status}</p><p className="text-sm opacity-70">{date(operation.occurredAt)} · {operation.attempts} attempt(s){operation.memberId && ` · Member ${operation.memberId}`}</p>{operation.errorCode && <p className="text-red-500">{operation.errorCode}</p>}{operation.kind === 'join.roles' && operation.status === 'failed' && configure && can('retry') && <button className={button} disabled={busy} onClick={() => { if (window.confirm('Retry default role assignment for this member? Honeypot bans prevent assignment.')) void run(async () => { await apiRequest(`/api/discord/operations/${operation.id}/retry`, {method: 'POST', body: JSON.stringify({requestKey: crypto.randomUUID()})}); setNotice('Join-role retry queued. Follow delivery in Activity.'); }); }}>Retry join roles</button>}</article>)}</section>}
      {tab === 'moderation' && <section className={box}><h2 className="text-lg font-semibold">Moderation cases</h2>{!cases.length && <p>No cases recorded.</p>}{cases.map(item => <article key={item.id} className="border-t border-[var(--border)] pt-3 space-y-2"><div className="flex flex-wrap justify-between gap-3"><div><strong>Member {item.memberId}</strong> · {item.action} · {item.status}<p className="text-sm opacity-70">Triggered {date(item.occurredAt)} · Timeout expiry {date(item.timeoutUntil)}{item.releasedAt && ` · Released ${date(item.releasedAt)}`}</p></div><div className="flex gap-2">{can('evidence_view') && <button className={button} onClick={() => { setCaseFilter(item.id); setTab('evidence'); }}>View evidence</button>}{can('timeout_release') && item.action === 'timeout' && !item.releasedAt && <button className={button} disabled={busy} onClick={() => { const reason = window.prompt(`Queue early timeout release for member ${item.memberId}? Optional reason:`, ''); if (reason !== null) void run(async () => { await apiRequest(`/api/discord/cases/${item.id}/release`, { method: 'POST', body: JSON.stringify({ requestKey: crypto.randomUUID(), ...(reason.trim() ? { reason: reason.trim() } : {}) }) }); await loadRows('moderation'); setNotice('Timeout release queued; it takes effect when the bot confirms completion.'); }); }}>Release timeout</button>}</div></div>{item.cleanup != null && <details><summary className="cursor-pointer text-sm">Cleanup result</summary><pre className="overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(item.cleanup, null, 2)}</pre></details>}</article>)}</section>}
      {tab === 'evidence' && <section className={box}><h2 className="text-lg font-semibold">Restricted moderation evidence</h2><div className="flex gap-3 items-center"><label>Show<select className={input} value={evidenceState} onChange={e => setEvidenceState(e.target.value)}><option value="active">Active evidence</option><option value="deleted">Deleted · recoverable</option></select></label>{caseFilter && <button className={button} onClick={() => setCaseFilter('')}>Clear case filter</button>}</div>{!evidence.length && <p>No evidence found.</p>}{evidence.map(item => <article className="border-t border-[var(--border)] pt-4 space-y-3" key={item.id}><div><strong>Member {item.authorId}</strong><p className="text-sm opacity-70">Captured {date(item.capturedAt)} · {item.indefinite ? 'Keep indefinitely' : `Retention until ${date(item.expiresAt)}`}</p>{item.deletedAt && <p className="text-sm">Deleted {date(item.deletedAt)} · Recoverable until {date(item.recoverUntil)}</p>}</div><pre className="whitespace-pre-wrap break-words rounded bg-[var(--background)] p-3 text-sm">{item.content || '(No text content)'}</pre><div className="flex flex-wrap gap-2">{item.attachments.map((attachment, i) => <button key={i} className={button} onClick={() => download(attachment)}>Download {attachment.name}</button>)}</div><div className="flex flex-wrap gap-2">{!item.deletedAt && can('evidence_delete') && <button className={button} disabled={busy} onClick={() => evidenceAction(item, 'delete')}>Delete evidence</button>}{item.deletedAt && can('evidence_restore') && <button className={button} disabled={busy || !item.recoverUntil || Date.parse(item.recoverUntil) <= now} onClick={() => evidenceAction(item, 'restore')}>Restore evidence</button>}{!item.deletedAt && !item.indefinite && can('evidence_retention') && <button className={button} disabled={busy} onClick={() => evidenceAction(item, 'indefinite')}>Keep indefinitely</button>}</div></article>)}</section>}
      {tab !== 'configuration' && cursor && <button className={button} disabled={busy} onClick={() => run(() => loadRows(tab, cursor))}>Load more</button>}
    </>}
  </main>;
}
