import { expect, test } from 'vitest';
import { defaultSettings } from '@/lib/discord/config';
import { inventoryError, parseDiagnostics } from '@/lib/discord/diagnostics';
const role = '123456789012345678', channel = '234567890123456789';
const diagnostics = {configRevision: 1, supportedSchemaVersions: [1], pendingCount: 0, failedCount: 0, issues: [], permissions: []};
test('diagnostics reject arbitrary text, unsupported fields, duplicate capabilities and unbounded values', () => {
  expect(parseDiagnostics(diagnostics)).toEqual(diagnostics);
  for (const change of [
    {configRevision: -1}, {pendingCount: 1.5}, {failedCount: '1'}, {supportedSchemaVersions: []}, {supportedSchemaVersions: [1, 1]}, {supportedSchemaVersions: [0]},
    {issues: [{code: 'secret text', severity: 'error'}]}, {issues: [{code: 'missing_permission', severity: 'fatal'}]}, {issues: [{code: 'missing_permission', severity: 'error', message: 'raw error'}]},
    {issues: [{code: 'missing_permission', severity: 'error', field: 'token'}]}, {issues: [{code: 'missing_permission', severity: 'error', resourceId: 'not-an-id'}]},
    {permissions: [{capability: 'manage roles', granted: true}]}, {permissions: [{capability: 'manage_roles', granted: 'yes'}]}, {permissions: [{capability: 'manage_roles', granted: true}, {capability: 'manage_roles', granted: false}]},
  ]) expect(parseDiagnostics({...diagnostics, ...change})).toBeNull();
});
test('fresh inventory checks existence separately from manageability for referenced roles and channels', () => {
  const metadata = {roles: [{id: role, manageable: false}], channels: [{id: channel, manageable: true}]};
  expect(inventoryError({...defaultSettings(), membershipRoleIds: [role]}, metadata, new Date())).toBeNull();
  expect(inventoryError({...defaultSettings(), defaultRoleIds: [role]}, metadata, new Date())).toMatch(/cannot manage/);
  expect(inventoryError({...defaultSettings(), welcomeEnabled: true, welcomeChannelId: channel, recruiterRoleId: role, recruitLobbyId: channel, rulesChannelId: channel}, metadata, new Date())).toBeNull();
  expect(inventoryError({...defaultSettings(), announcementsEnabled: true, announcementChannelId: channel, mentionRoleIds: [role]}, metadata, new Date())).toBeNull();
  expect(inventoryError({...defaultSettings(), honeypotEnabled: true, honeypotChannelId: channel, staffLogChannelId: channel}, metadata, new Date())).toBeNull();
  expect(inventoryError({...defaultSettings(), menus: [{id: 'games', title: 'Games', description: '', channelId: channel, singleChoice: false, entries: [{emoji: 'a', label: 'A', roleId: role}]}]}, metadata, new Date())).toMatch(/cannot manage/);
  expect(inventoryError({...defaultSettings(), defaultRoleIds: [role]}, metadata, null)).toBeNull();
});
