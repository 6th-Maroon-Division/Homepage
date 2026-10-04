'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiRequest } from '@/lib/api/client';

type AnnouncementData = {
  announcement: null | { channelId: string; mention: string; missionText: string; messageId: string | null; missingAt?: string | null; lastRenderedAt?: string | null };
  config: { guildId: string; announcementChannelId: string; mentionRoleIds: string[]; allowEveryoneMention: boolean; announcementTemplate: string; announcementsEnabled: boolean; websiteUrl: string };
  commands: { id: number; status: string; kind: string; errorCode?: string | null }[];
};

export default function DiscordAnnouncementPanel({ orbatId, name }: { orbatId: number; name: string }) {
  const [data, setData] = useState<AnnouncementData | null>(null);
  const [channelId, setChannelId] = useState('');
  const [mention, setMention] = useState('none');
  const [missionText, setMissionText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const endpoint = `/api/discord/announcements/${orbatId}`;
  const load = useCallback(async (initialize = false) => {
    try {
      const result = await apiRequest<AnnouncementData>(endpoint, { cache: 'no-store' });
      setData(result.data);
      if (initialize) {
        setChannelId(result.data.announcement?.channelId || result.data.config.announcementChannelId);
        setMention(result.data.announcement?.mention || 'none');
        setMissionText(result.data.announcement?.missionText ?? result.data.config.announcementTemplate.replaceAll('{orbat}', name));
      }
      setError('');
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to load announcement.'); }
  }, [endpoint, name]);
  useEffect(() => {
    // State is updated only after the asynchronous API request completes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(true);
    const timer = setInterval(() => { void load(); }, 15000);
    return () => clearInterval(timer);
  }, [load]);

  async function send(action: 'publish' | 'refresh' | 'reping' | 'repost') {
    setBusy(true); setError(''); setNotice('');
    try {
      await apiRequest(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestKey: crypto.randomUUID(), action, channelId, mention: action === 'repost' ? 'none' : mention, missionText }) });
      setNotice('Request queued. Delivery status appears below.');
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to queue announcement.'); }
    finally { setBusy(false); }
  }

  const existing = !!data?.announcement?.messageId;
  const missing = !!data?.announcement?.missingAt;
  const channelLocked = !!data?.announcement;
  const queued = data?.commands.some(command => ['pending', 'claimed', 'running', 'retrying'].includes(command.status));
  const disabled = busy || queued || !data?.config.announcementsEnabled || !channelId || !missionText.trim();
  const inputClass = 'w-full rounded border border-slate-600 bg-slate-900 p-2 text-slate-100';
  const buttonClass = 'rounded bg-indigo-700 px-4 py-2 text-white disabled:opacity-50 disabled:cursor-not-allowed';
  const orbatUrl = `${data?.config.websiteUrl.replace(/\/$/, '') || ''}/orbats/${orbatId}`;
  return (
    <section className="mt-8 space-y-4 rounded-xl border border-slate-700 bg-slate-800 p-5" aria-labelledby="discord-announcement-title">
      <h2 id="discord-announcement-title" className="text-xl font-semibold">Discord announcement</h2>
      {error && <p role="alert" className="text-red-300">{error}</p>}
      {notice && <p role="status" className="text-green-300">{notice}</p>}
      {!data ? <button className={buttonClass} onClick={() => void load(true)}>Load announcement settings</button> : <>
        {!data.config.announcementsEnabled && <p>Mission announcements are disabled. Enable them in the Discord configuration first.</p>}
        {missing && <p role="alert" className="rounded border border-amber-500 p-3">The bot reported that the Discord message is missing. Repost it explicitly to resume roster updates. Reposting will not ping members.</p>}
        {data.announcement?.lastRenderedAt && <p className="text-sm text-slate-300">The bot has confirmed an automatic roster update.</p>}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <label className="block space-y-1">Destination channel ID<input className={inputClass} value={channelId} onChange={e => setChannelId(e.target.value)} disabled={channelLocked || busy} inputMode="numeric" pattern="[0-9]{17,20}" /></label>
            <p className="text-sm text-slate-300">{channelLocked ? 'This announcement keeps its original channel for future updates.' : 'Prefilled from the default mission ping channel in Discord configuration. Change it here to override it for this ORBAT.'}</p>
            {!channelLocked && <button type="button" className="rounded border border-slate-500 px-3 py-2 text-sm disabled:opacity-50" disabled={busy || channelId === data.config.announcementChannelId} onClick={() => setChannelId(data.config.announcementChannelId)}>Use default channel</button>}
          </div>
          <label className="space-y-1">Mention<select className={inputClass} value={mention} onChange={e => setMention(e.target.value)} disabled={busy}>
            <option value="none">No mention</option>
            {data.config.allowEveryoneMention && <option value="everyone">@everyone</option>}
            {data.config.mentionRoleIds.map(id => <option key={id} value={id}>Role {id}</option>)}
          </select></label>
        </div>
        <label className="block space-y-1">Mission message<textarea className={inputClass} rows={4} maxLength={1800} value={missionText} onChange={e => setMissionText(e.target.value)} disabled={busy} /></label>
        <details className="rounded border border-slate-600 p-3">
          <summary className="cursor-pointer font-medium">Preview announcement</summary>
          <p className="mt-3 text-sm text-slate-400">Text preview; Discord renders formatting and mentions on delivery.</p>
          <p className="whitespace-pre-wrap py-2">{mention === 'everyone' ? '@everyone ' : mention !== 'none' ? `<@&${mention}> ` : ''}{missionText}</p>
          <a className="text-blue-300 underline" href={orbatUrl}>{name} | ORBAT</a>
          {/* Generated images are dynamic, so avoid the image optimizer cache. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="mt-3 h-auto w-full rounded" src={`/orbats/${orbatId}/opengraph-image`} alt={`${name}: squad roles with signup occupancy`} width={1200} height={630} />
        </details>
        <div className="flex flex-wrap gap-3">
          {!existing && <button className={buttonClass} disabled={disabled} onClick={() => void send('publish')}>Announce to Discord</button>}
          {existing && !missing && <>
            <button className={buttonClass} disabled={disabled} onClick={() => void send('refresh')}>Refresh without ping</button>
            <button className={buttonClass} disabled={disabled || mention === 'none'} onClick={() => void send('reping')}>Send another ping</button>
          </>}
          {missing && <button className={buttonClass} disabled={disabled} onClick={() => void send('repost')}>Repost missing message without ping</button>}
          {data.announcement?.messageId && <a className="rounded border border-slate-500 px-4 py-2" target="_blank" rel="noreferrer" href={`https://discord.com/channels/${data.config.guildId}/${data.announcement.channelId}/${data.announcement.messageId}`}>View Discord message</a>}
        </div>
        {queued && <p role="status">Waiting for the bot to apply the queued announcement request.</p>}
        <ul className="space-y-1 text-sm" aria-label="Recent announcement delivery status">
          {data.commands.map(command => <li key={command.id}>Request #{command.id}: {command.status}{command.errorCode ? ` — ${command.errorCode}` : ''}</li>)}
        </ul>
      </>}
    </section>
  );
}
