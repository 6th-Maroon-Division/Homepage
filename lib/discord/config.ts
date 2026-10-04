/** Shared form metadata and strict contract; contains no credentials. */
export type Field = { key: string; label: string; group: string; type: 'text' | 'url' | 'id' | 'ids' | 'number' | 'boolean' | 'textarea' | 'color'; default: string | number | boolean | string[]; min?: number; max?: number };
export const CONFIG_FIELDS: Field[] = [
  { key: 'guildId', label: 'Discord server ID', group: 'Connection', type: 'id', default: '' },
  { key: 'websiteUrl', label: 'Public website URL', group: 'Connection', type: 'url', default: '' },
  { key: 'defaultRoleIds', label: 'Default join roles', group: 'Joining', type: 'ids', default: [] },
  { key: 'joinRetryFirstSeconds', label: 'First join-role retry delay (seconds)', group: 'Joining', type: 'number', default: 10, min: 1, max: 3600 },
  { key: 'joinRetrySecondSeconds', label: 'Second retry delay (seconds)', group: 'Joining', type: 'number', default: 30, min: 1, max: 3600 },
  { key: 'welcomeEnabled', label: 'Welcome members on joining', group: 'Welcome', type: 'boolean', default: false },
  { key: 'welcomeReturning', label: 'Welcome returning members', group: 'Welcome', type: 'boolean', default: true },
  { key: 'welcomeChannelId', label: 'Welcome channel', group: 'Welcome', type: 'id', default: '' },
  { key: 'recruiterRoleId', label: 'Recruiter role', group: 'Welcome', type: 'id', default: '' },
  { key: 'recruitLobbyId', label: 'Recruitment lobby channel', group: 'Welcome', type: 'id', default: '' },
  { key: 'rulesChannelId', label: 'Rules channel', group: 'Welcome', type: 'id', default: '' },
  { key: 'guidebookUrl', label: 'Guidebook URL', group: 'Welcome', type: 'url', default: '' },
  { key: 'welcomeTemplate', label: 'Welcome message', group: 'Welcome', type: 'textarea', default: '**From the 6MD recruitment team,**\nHey {member}, welcome to **{server}**! Sit tight and {recruiter_role} will give you an introduction. Questions? Visit {recruit_lobby}. [Guidebook]({guidebook_url}) | Rules: {rules_channel}' },
  { key: 'announcementsEnabled', label: 'Enable mission announcements', group: 'Announcements', type: 'boolean', default: false },
  { key: 'announcementChannelId', label: 'Default mission ping channel', group: 'Announcements', type: 'id', default: '' },
  { key: 'allowEveryoneMention', label: 'Allow an explicit everyone ping', group: 'Announcements', type: 'boolean', default: false },
  { key: 'mentionRoleIds', label: 'Allowed mention roles', group: 'Announcements', type: 'ids', default: [] },
  { key: 'announcementTemplate', label: 'Default mission message ({orbat})', group: 'Announcements', type: 'textarea', default: '{orbat} ORBAT is out!' },
  { key: 'signupEnabled', label: 'Enable Discord signup buttons', group: 'Announcements', type: 'boolean', default: true },
  { key: 'availabilityEnabled', label: 'Enable availability buttons', group: 'Announcements', type: 'boolean', default: true },
  { key: 'updateBatchSeconds', label: 'Roster refresh batching (seconds)', group: 'Announcements', type: 'number', default: 5, min: 1, max: 300 },
  { key: 'availableColor', label: 'Empty slot color', group: 'Announcements', type: 'color', default: '#334155' },
  { key: 'partialColor', label: 'Partially filled slot color', group: 'Announcements', type: 'color', default: '#92400e' },
  { key: 'fullColor', label: 'Assigned slot color', group: 'Announcements', type: 'color', default: '#166534' },
  { key: 'honeypotEnabled', label: 'Enable honeypot enforcement', group: 'Honeypot', type: 'boolean', default: false },
  { key: 'honeypotChannelId', label: 'Honeypot channel', group: 'Honeypot', type: 'id', default: '' },
  { key: 'membershipRoleIds', label: 'Membership roles (Regulars, Retired, Friend of Group, Joint-operations)', group: 'Honeypot', type: 'ids', default: [] },
  { key: 'exemptRoleIds', label: 'Exempt roles', group: 'Honeypot', type: 'ids', default: [] },
  { key: 'exemptUserIds', label: 'Exempt Discord users', group: 'Honeypot', type: 'ids', default: [] },
  { key: 'timeoutHours', label: 'Timeout duration (hours)', group: 'Honeypot', type: 'number', default: 24, min: 24, max: 672 },
  { key: 'staffLogChannelId', label: 'Staff log channel', group: 'Honeypot', type: 'id', default: '' },
  { key: 'nicknameSync', label: 'Synchronize names', group: 'Rank and name sync', type: 'boolean', default: false },
  { key: 'rankRoleSync', label: 'Synchronize rank roles', group: 'Rank and name sync', type: 'boolean', default: false },
  { key: 'nicknameFormat', label: 'Discord nickname format', group: 'Rank and name sync', type: 'text', default: '[{rank}] {name}' },
  { key: 'syncExemptUserIds', label: 'Synchronization-exempt users', group: 'Rank and name sync', type: 'ids', default: [] },
  { key: 'pollSeconds', label: 'Configuration polling (seconds)', group: 'Operations', type: 'number', default: 60, min: 10, max: 3600 },
  { key: 'freshnessSeconds', label: 'Offline configuration lifetime (seconds)', group: 'Operations', type: 'number', default: 900, min: 60, max: 86400 },
  { key: 'heartbeatSeconds', label: 'Heartbeat interval (seconds)', group: 'Operations', type: 'number', default: 60, min: 10, max: 300 },
  { key: 'reconcileSeconds', label: 'Reconciliation interval (seconds)', group: 'Operations', type: 'number', default: 3600, min: 60, max: 86400 },
  { key: 'requestTimeoutSeconds', label: 'API request timeout (seconds)', group: 'Operations', type: 'number', default: 30, min: 5, max: 120 },
  { key: 'retryDelays', label: 'Retry delays in seconds (five comma-separated values)', group: 'Operations', type: 'text', default: '5,15,60,300,900' },
  { key: 'retryJitterSeconds', label: 'Maximum added retry jitter (seconds)', group: 'Operations', type: 'number', default: 2, min: 0, max: 60 },
];
export type MenuEntry = { emoji: string; label: string; roleId: string };
export type RoleMenu = { id: string; title: string; description: string; channelId: string; singleChoice: boolean; entries: MenuEntry[] };
export type DiscordSettings = Record<string, string | number | boolean | string[] | RoleMenu[]> & { menus: RoleMenu[] };
export const defaultSettings = (): DiscordSettings => ({ ...Object.fromEntries(CONFIG_FIELDS.map(f => [f.key, Array.isArray(f.default) ? [...f.default] : f.default])), menus: [] });
export type Retention = { mode: 'days' | 'indefinite'; days: number | null };
export const DEFAULT_RETENTION: Retention = { mode: 'days', days: 7 };
export const snowflake = (v: unknown): v is string => typeof v === 'string' && /^\d{17,20}$/.test(v);
export const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
export function parseRetention(v: unknown): Retention | null {
  if (!record(v) || Object.keys(v).some(k => !['mode', 'days'].includes(k))) return null;
  if (v.mode === 'indefinite' && v.days === null) return { mode: 'indefinite', days: null };
  return v.mode === 'days' && Number.isInteger(v.days) && Number(v.days) >= 7 && Number(v.days) <= 36500 ? { mode: 'days', days: Number(v.days) } : null;
}
export function parseSettings(v: unknown): { data?: DiscordSettings; error?: string } {
  if (!record(v) || Object.keys(v).some(k => !CONFIG_FIELDS.some(f => f.key === k) && k !== 'menus')) return { error: 'Unknown configuration field.' };
  for (const f of CONFIG_FIELDS) {
    const value = v[f.key];
    let valid = false;
    if (f.type === 'boolean') valid = typeof value === 'boolean';
    else if (f.type === 'number') valid = Number.isInteger(value) && Number(value) >= f.min! && Number(value) <= f.max!;
    else if (f.type === 'ids') valid = Array.isArray(value) && value.length <= 100 && value.every(snowflake) && new Set(value).size === value.length;
    else if (typeof value === 'string') {
      valid = value.length <= (f.type === 'textarea' ? 1800 : 500);
      if (f.type === 'id') valid = value === '' || snowflake(value);
      if (f.type === 'color') valid = /^#[0-9a-fA-F]{6}$/.test(value);
      if (f.type === 'url' && value) { try { const u = new URL(value); valid = ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password; } catch { valid = false; } }
    }
    if (!valid) return { error: `Invalid ${f.label}.` };
  }
  if (!Array.isArray(v.menus) || v.menus.length > 25) return { error: 'Use up to 25 role-menu categories.' };
  const roleIds = new Set<string>(); const menuIds = new Set<string>();
  for (const menu of v.menus) {
    if (!record(menu) || Object.keys(menu).some(k => !['id', 'title', 'description', 'channelId', 'singleChoice', 'entries'].includes(k)) || typeof menu.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(menu.id) || menuIds.has(menu.id) || typeof menu.title !== 'string' || !menu.title.trim() || menu.title.length > 100 || typeof menu.description !== 'string' || menu.description.length > 1000 || !snowflake(menu.channelId) || typeof menu.singleChoice !== 'boolean' || !Array.isArray(menu.entries) || !menu.entries.length || menu.entries.length > 20) return { error: 'Invalid role menu (maximum 20 entries per message).' };
    menuIds.add(menu.id); const emojis = new Set<string>();
    for (const entry of menu.entries) {
      if (!record(entry) || Object.keys(entry).some(k => !['emoji', 'label', 'roleId'].includes(k)) || typeof entry.emoji !== 'string' || !entry.emoji.trim() || entry.emoji.length > 100 || emojis.has(entry.emoji) || typeof entry.label !== 'string' || !entry.label.trim() || entry.label.length > 100 || !snowflake(entry.roleId) || roleIds.has(entry.roleId)) return { error: 'Menu entries need a unique emoji and role, and a label.' };
      emojis.add(entry.emoji); roleIds.add(entry.roleId);
    }
  }
  const config = v as DiscordSettings;
  if (['defaultRoleIds', 'membershipRoleIds', 'exemptRoleIds'].some(key => (config[key] as string[]).some(id => roleIds.has(id))) || roleIds.has(String(config.recruiterRoleId))) return { error: 'Reaction roles cannot also be default, membership, staff, or exempt roles.' };
  if ((config.defaultRoleIds as string[]).some(id => (config.membershipRoleIds as string[]).includes(id))) return { error: 'Default join roles cannot establish membership.' };
  if (!/^\d+(,\d+){4}$/.test(String(config.retryDelays)) || String(config.retryDelays).split(',').some(n => Number(n) < 1 || Number(n) > 86400)) return { error: 'Provide five retry delays between 1 and 86400 seconds.' };
  if (!String(config.nicknameFormat).includes('{name}') || !String(config.nicknameFormat).includes('{rank}')) return { error: 'Nickname format must contain {rank} and {name}.' };
  if (Number(config.freshnessSeconds) < Number(config.pollSeconds)) return { error: 'Configuration lifetime must cover at least one polling interval.' };
  if ((config.welcomeEnabled || config.announcementsEnabled || config.honeypotEnabled || config.nicknameSync || config.rankRoleSync || config.menus.length || (config.defaultRoleIds as string[]).length) && (!config.guildId || !config.websiteUrl)) return { error: 'Configure the server and website URL before enabling features.' };
  if (config.welcomeEnabled && !config.welcomeChannelId || config.announcementsEnabled && !config.announcementChannelId || config.honeypotEnabled && (!config.honeypotChannelId || !(config.membershipRoleIds as string[]).length || !config.staffLogChannelId)) return { error: 'Enabled features require their destination channels; honeypot requires membership roles and a staff log.' };
  return { data: config };
}
export function classifyMember(settings: DiscordSettings, memberId: string, roles: string[]): 'exempt' | 'timeout' | 'ban' {
  if ((settings.exemptUserIds as string[]).includes(memberId) || roles.some(id => (settings.exemptRoleIds as string[]).includes(id))) return 'exempt';
  return roles.some(id => (settings.membershipRoleIds as string[]).includes(id)) ? 'timeout' : 'ban';
}
