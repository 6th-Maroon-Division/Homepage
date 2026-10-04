import { CONFIG_FIELDS, record, snowflake, type DiscordSettings } from './config';

export type Diagnostics = {
  configRevision: number;
  supportedSchemaVersions: number[];
  pendingCount: number;
  failedCount: number;
  issues: { code: string; severity: 'warning' | 'error'; field?: string; resourceId?: string }[];
  permissions: { capability: string; granted: boolean }[];
};
const integer = (value: unknown) => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 2147483647;
const code = (value: unknown) => typeof value === 'string' && /^[a-z][a-z0-9_.-]{0,79}$/.test(value);
export function parseDiagnostics(value: unknown): Diagnostics | null {
  if (!record(value) || Object.keys(value).some(key => !['configRevision', 'supportedSchemaVersions', 'pendingCount', 'failedCount', 'issues', 'permissions'].includes(key))) return null;
  if (!integer(value.configRevision) || !integer(value.pendingCount) || !integer(value.failedCount)) return null;
  if (!Array.isArray(value.supportedSchemaVersions) || !value.supportedSchemaVersions.length || value.supportedSchemaVersions.length > 20 || value.supportedSchemaVersions.some(v => !integer(v) || v < 1) || new Set(value.supportedSchemaVersions).size !== value.supportedSchemaVersions.length) return null;
  if (!Array.isArray(value.issues) || value.issues.length > 100 || value.issues.some(issue => !record(issue) || Object.keys(issue).some(key => !['code', 'severity', 'field', 'resourceId'].includes(key)) || !code(issue.code) || !['warning', 'error'].includes(String(issue.severity)) || issue.field !== undefined && !CONFIG_FIELDS.some(field => field.key === issue.field) && issue.field !== 'menus' || issue.resourceId !== undefined && !snowflake(issue.resourceId))) return null;
  if (!Array.isArray(value.permissions) || value.permissions.length > 100 || value.permissions.some(permission => !record(permission) || Object.keys(permission).some(key => !['capability', 'granted'].includes(key)) || !code(permission.capability) || typeof permission.granted !== 'boolean') || new Set(value.permissions.map(p => p.capability)).size !== value.permissions.length) return null;
  return value as Diagnostics;
}

/** Fresh guild inventories validate referenced IDs without making offline edits impossible. */
export function inventoryError(settings: DiscordSettings, metadata: unknown, observedAt: Date | null | undefined, now = Date.now()): string | null {
  if (!observedAt || now - observedAt.getTime() > Number(settings.freshnessSeconds) * 1000 || !record(metadata) || !Array.isArray(metadata.roles) || !Array.isArray(metadata.channels)) return null;
  const roles = metadata.roles as {id: string; manageable: boolean}[];
  const channels = metadata.channels as {id: string; manageable: boolean}[];
  const references: {id: string; field: string; channel?: boolean; manage?: boolean}[] = [];
  for (const key of ['defaultRoleIds', 'membershipRoleIds', 'exemptRoleIds']) for (const id of settings[key] as string[]) references.push({id, field: key, manage: key === 'defaultRoleIds'});
  if (settings.welcomeEnabled) {
    if (settings.recruiterRoleId) references.push({id: String(settings.recruiterRoleId), field: 'recruiterRoleId'});
    for (const key of ['welcomeChannelId', 'recruitLobbyId', 'rulesChannelId']) if (settings[key]) references.push({id: String(settings[key]), field: key, channel: true, manage: key === 'welcomeChannelId'});
  }
  if (settings.announcementsEnabled) {
    references.push({id: String(settings.announcementChannelId), field: 'announcementChannelId', channel: true, manage: true});
    for (const id of settings.mentionRoleIds as string[]) references.push({id, field: 'mentionRoleIds'});
  }
  if (settings.honeypotEnabled) for (const key of ['honeypotChannelId', 'staffLogChannelId']) references.push({id: String(settings[key]), field: key, channel: true, manage: true});
  for (const menu of settings.menus) {
    references.push({id: menu.channelId, field: 'menus', channel: true, manage: true});
    for (const entry of menu.entries) references.push({id: entry.roleId, field: 'menus', manage: true});
  }
  for (const reference of references) {
    const item = (reference.channel ? channels : roles).find(item => item.id === reference.id);
    if (!item) return `${reference.field}: ${reference.id} is missing from the latest server inventory.`;
    if (reference.manage && !item.manageable) return `${reference.field}: the bot cannot manage ${reference.id}. Check Discord permissions and role hierarchy.`;
  }
  return null;
}
