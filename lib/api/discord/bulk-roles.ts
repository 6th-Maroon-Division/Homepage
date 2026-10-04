import { isDeepStrictEqual } from 'node:util';
import type { DiscordBulkRoleAction, DiscordCommand, Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import { apiSuccess } from '@/lib/api/response';
import { writeApiAudit } from '@/lib/api/audit';
import { hasApiPermission, parsePermissionGrants } from '@/lib/api/permissions';
import { record, snowflake } from '@/lib/discord/config';
import { body, botOnly, discordApi, fail, id, int, integration, json, pagination, pageResult, query, transaction } from './shared';
import { enqueue } from './commands';

const lifetime = 15 * 60 * 1000;
const pageSize = 100;
const requestKeyValid = (v: unknown): v is string => typeof v === 'string' && /^[-a-zA-Z0-9_]{8,80}$/.test(v);
const errorValid = (v: unknown): v is string => typeof v === 'string' && /^[-a-z_0-9]{1,80}$/.test(v);

async function roleSafety(tx: Prisma.TransactionClient, action: string, roleIds: string[], guildId: string) {
  const { settings } = await integration(tx);
  const rankRoles = await tx.rankDiscordRole.findMany({ where: { guildId, isActive: true }, select: { discordRoleId: true } });
  const protectedIds = [...settings.membershipRoleIds as string[], ...settings.exemptRoleIds as string[], String(settings.recruiterRoleId), ...rankRoles.map(r => r.discordRoleId)];
  if (action === 'remove_menu_role') protectedIds.push(...settings.defaultRoleIds as string[]);
  if (roleIds.some(roleId => protectedIds.includes(roleId) || roleId === guildId)) fail(409, 'Protected membership, rank, staff, exempt or default roles cannot be changed by this action.');
  if (action === 'apply_defaults' && !isDeepStrictEqual(roleIds, settings.defaultRoleIds)) fail(409, 'Default roles changed. Create a new preview.');
}
async function validPlan(tx: Prisma.TransactionClient, plan: DiscordBulkRoleAction) {
  if (plan.expiresAt <= new Date()) fail(409, 'Preview expired. Create a new preview.');
  const { row, settings } = await integration(tx);
  if (row?.revision !== plan.configRevision || settings.guildId !== plan.guildId) fail(409, 'Configuration changed. Create a new preview.');
  await roleSafety(tx, plan.action, plan.roleIds as string[], plan.guildId);
}
async function planById(tx: Prisma.TransactionClient, value: number) {
  const plan = await tx.discordBulkRoleAction.findUnique({ where: { id: value } });
  if (!plan) return fail(404, 'Bulk role action not found.');
  return plan;
}
async function activeClaim(tx: Prisma.TransactionClient, commandId: number | null, tokenId: number, input: Record<string, unknown>) {
  if (typeof input.claimToken !== 'string' || !int(input.generation, 1)) fail(422, 'Claim token and generation are required.');
  if (commandId === null) return fail(409, 'Action is not queued.');
  const command = await tx.discordCommand.findUnique({ where: { id: commandId } });
  if (!command || command.status !== 'running' || command.claimedBy !== tokenId || command.claimToken !== input.claimToken || command.generation !== input.generation || !command.leaseUntil || command.leaseUntil <= new Date()) return fail(409, 'Claim expired or was superseded.');
  const user = command.requestedBy === null ? null : await tx.user.findUnique({ where: { id: command.requestedBy }, select: { userPermissions: { select: { value: true, permission: { select: { key: true } } } } } });
  const permissions = parsePermissionGrants(Object.fromEntries(user?.userPermissions.map(p => [p.permission.key, p.value]) ?? [])) ?? {};
  if (!hasApiPermission(permissions, 'discord:configure')) fail(403, 'Requesting administrator no longer has configuration access.');
  return command;
}

export function bulkRoles(request: Request, method: 'GET' | 'POST') {
  return discordApi(request, 'discord:configure', async (principal, audit) => {
    if (method === 'GET') {
      const { cursor, limit } = pagination(request, ['requestKey']);
      const requestKey = new URL(request.url).searchParams.get('requestKey');
      if (requestKey !== null && !requestKeyValid(requestKey)) fail(400, 'Invalid bulk request key.');
      const rows = await prisma.discordBulkRoleAction.findMany({ where: { ...(cursor ? { id: { lt: cursor } } : {}), ...(requestKey ? { requestKey } : {}) }, orderBy: { id: 'desc' }, take: limit + 1 });
      const page = pageResult(rows, limit); return apiSuccess(page.data, { meta: page.meta });
    }
    if (principal.kind !== 'user') return fail(403, 'Bulk changes require a website administrator review.');
    query(request);
    const input = await body(request, ['requestKey', 'action', 'roleId']);
    if (!requestKeyValid(input.requestKey) || !['apply_defaults', 'remove_menu_role'].includes(String(input.action)) || (input.action === 'remove_menu_role' ? !snowflake(input.roleId) : input.roleId !== undefined)) fail(422, 'Choose current default roles or a previously configured menu role.');
    const result = await transaction(async tx => {
      const existing = await tx.discordBulkRoleAction.findUnique({ where: { requestKey: String(input.requestKey) } });
      if (existing) {
        if (existing.requestedBy !== principal.userId || existing.action !== input.action || input.action === 'remove_menu_role' && !isDeepStrictEqual(existing.roleIds, [input.roleId])) fail(409, 'Request key already belongs to another action.');
        return existing;
      }
      const { row, settings } = await integration(tx);
      if (!row || !settings.guildId) return fail(409, 'Configure the Discord server first.');
      const roleIds = input.action === 'apply_defaults' ? settings.defaultRoleIds as string[] : [String(input.roleId)];
      if (!roleIds.length) fail(409, 'No default roles are configured.');
      if (input.action === 'remove_menu_role' && !settings.menus.some(menu => menu.entries.some(entry => entry.roleId === input.roleId))) {
        const historic = await tx.discordConfigurationRevision.findFirst({ where: { settings: { path: ['menus'], array_contains: [{ entries: [{ roleId: String(input.roleId) }] }] } } });
        if (!historic) fail(422, 'Role has never been configured as a menu role.');
      }
      await roleSafety(tx, String(input.action), roleIds, String(settings.guildId));
      const command = await enqueue(tx, principal, audit, `bulk-preview-${input.requestKey}`, 'bulk.preview', { bulkRequestKey: input.requestKey });
      const plan = await tx.discordBulkRoleAction.create({ data: { requestKey: String(input.requestKey), action: String(input.action), roleIds: json(roleIds), guildId: String(settings.guildId), configRevision: row.revision, requestedBy: principal.userId, previewCommandId: command.id, expiresAt: new Date(Date.now() + lifetime) } });
      await writeApiAudit(tx, audit, { action: 'discord.bulk.preview.requested', resource: 'discord_bulk_role_action', resourceId: String(plan.id), outcome: 'success' });
      return plan;
    });
    return apiSuccess(result, { status: 202 });
  });
}

export function bulkRoleDetail(request: Request, value: string) {
  return discordApi(request, 'discord:configure', async (_, audit) => {
    query(request, ['page']); const actionId = id(value);
    const rawPage = new URL(request.url).searchParams.get('page');
    if (rawPage !== null && !/^\d{1,2}$/.test(rawPage)) fail(400, 'Page must be from 0 to 99.');
    const page = Number(rawPage ?? 0);
    const plan = await planById(prisma, actionId);
    const snapshot = await prisma.discordBulkRolePage.findUnique({ where: { actionId_page: { actionId, page } } });
    await writeApiAudit(prisma, audit, { action: 'discord.bulk.preview.read', resource: 'discord_bulk_role_action', resourceId: value, outcome: 'success' });
    return apiSuccess({ ...plan, page: snapshot, nextPage: page + 1 < plan.nextPage ? page + 1 : null });
  });
}

export function bulkRoleSnapshot(request: Request, value: string) {
  return discordApi(request, undefined, async (principal, audit) => {
    botOnly(principal); query(request); const actionId = id(value);
    const input = await body(request, ['claimToken', 'generation', 'page', 'memberIds', 'final'], 10000);
    if (!int(input.page, 0, 99) || typeof input.final !== 'boolean' || !Array.isArray(input.memberIds) || input.memberIds.length > pageSize || !input.memberIds.every(snowflake) || new Set(input.memberIds).size !== input.memberIds.length || !input.final && !input.memberIds.length) fail(422, 'Supply a unique bounded page of Discord member IDs.');
    const memberIds = input.memberIds as string[];
    const result = await transaction(async tx => {
      const plan = await planById(tx, actionId);
      // A sealed final page may be retried after its command was acknowledged.
      const command = await tx.discordCommand.findUnique({ where: { id: plan.previewCommandId } });
      if (!command || command.claimedBy !== principal.tokenId || command.claimToken !== input.claimToken || command.generation !== input.generation) fail(409, 'This preview claim was superseded.');
      const existing = await tx.discordBulkRolePage.findUnique({ where: { actionId_page: { actionId, page: Number(input.page) } } });
      if (existing) {
        if (existing.final !== input.final || !isDeepStrictEqual(existing.memberIds, memberIds)) fail(409, 'Snapshot page already has different members.');
        return plan;
      }
      await activeClaim(tx, plan.previewCommandId, principal.tokenId, input); await validPlan(tx, plan);
      if (plan.status !== 'preview_pending' || plan.nextPage !== input.page || input.page === 99 && !input.final) fail(409, 'Upload pages in order and finish within 100 pages.');
      const previous = await tx.discordBulkRolePage.findMany({ where: { actionId }, select: { memberIds: true } });
      const seen = new Set(previous.flatMap(page => page.memberIds as string[]));
      if (memberIds.some(memberId => seen.has(memberId))) fail(422, 'Members must appear only once in a preview.');
      await tx.discordBulkRolePage.create({ data: { actionId, page: Number(input.page), memberIds: json(memberIds), final: Boolean(input.final) } });
      const updated = await tx.discordBulkRoleAction.update({ where: { id: actionId }, data: { nextPage: { increment: 1 }, memberCount: { increment: memberIds.length }, version: { increment: 1 }, ...(input.final ? { status: 'ready' } : {}) } });
      if (input.final) await tx.discordCommand.update({ where: { id: plan.previewCommandId }, data: { status: 'succeeded', result: {}, errorCode: null, leaseUntil: null } });
      await writeApiAudit(tx, audit, { action: 'discord.bulk.preview.page', resource: 'discord_bulk_role_action', resourceId: value, outcome: 'success', after: { page: input.page, memberCount: memberIds.length, final: input.final } });
      return updated;
    }); return apiSuccess(result);
  });
}

export function bulkRoleConfirm(request: Request, value: string) {
  return discordApi(request, 'discord:configure', async (principal, audit) => {
    if (principal.kind !== 'user') return fail(403, 'Bulk changes require a website administrator review.');
    query(request); const actionId = id(value); const input = await body(request, ['version', 'requestKey']);
    if (!int(input.version, 1) || !requestKeyValid(input.requestKey)) fail(422, 'Reviewed version and stable request key are required.');
    const result = await transaction(async tx => {
      const plan = await planById(tx, actionId);
      if (plan.executeCommandId !== null) {
        const existing = await tx.discordCommand.findUnique({ where: { id: plan.executeCommandId } });
        if (existing?.requestKey !== `bulk-execute-${input.requestKey}` || existing.requestedBy !== principal.userId || plan.version !== Number(input.version) + 1) fail(409, 'Action was already confirmed differently.');
        return plan;
      }
      await validPlan(tx, plan);
      if (plan.status !== 'ready' || plan.version !== input.version || plan.memberCount === 0) fail(409, 'Review a complete, nonempty and current preview first.');
      const command = await enqueue(tx, principal, audit, `bulk-execute-${input.requestKey}`, 'bulk.execute', { bulkRequestKey: plan.requestKey });
      const updated = await tx.discordBulkRoleAction.update({ where: { id: actionId }, data: { executeCommandId: command.id, status: 'queued', version: { increment: 1 } } });
      await writeApiAudit(tx, audit, { action: 'discord.bulk.confirmed', resource: 'discord_bulk_role_action', resourceId: value, outcome: 'success', after: { memberCount: plan.memberCount, version: input.version } });
      return updated;
    }); return apiSuccess(result, { status: 202 });
  });
}

export function bulkRoleTargets(request: Request, value: string, outcomes: boolean) {
  return discordApi(request, undefined, async (principal, audit) => {
    botOnly(principal); query(request); const actionId = id(value);
    const input = await body(request, ['claimToken', 'generation', 'page', ...(outcomes ? ['outcomes'] : [])], 30000);
    if (!int(input.page, 0, 99)) fail(422, 'Page must be from 0 to 99.');
    const result = await transaction(async tx => {
      const plan = await planById(tx, actionId);
      const receiptCommand = await tx.discordCommand.findUnique({ where: { id: plan.executeCommandId ?? 0 } });
      if (!receiptCommand || receiptCommand.claimedBy !== principal.tokenId || receiptCommand.claimToken !== input.claimToken || receiptCommand.generation !== input.generation) fail(409, 'This execution claim was superseded.');
      const page = await tx.discordBulkRolePage.findUnique({ where: { actionId_page: { actionId, page: Number(input.page) } } });
      if (!page) return fail(404, 'Snapshot page not found.');
      const members = page.memberIds as string[];
      if (outcomes) {
        if (!Array.isArray(input.outcomes) || input.outcomes.length !== members.length || input.outcomes.some(entry => !record(entry) || Object.keys(entry).some(key => !['memberId', 'status', 'errorCode'].includes(key)) || !members.includes(String(entry.memberId)) || !['applied', 'skipped', 'failed'].includes(String(entry.status)) || (entry.status === 'failed' ? !errorValid(entry.errorCode) : entry.errorCode !== undefined)) || new Set(input.outcomes.map(entry => entry.memberId)).size !== members.length) fail(422, 'Report exactly one bounded outcome for every reviewed member.');
        if (page.outcomes !== null) {
          if (!isDeepStrictEqual(page.outcomes, input.outcomes)) fail(409, 'Page outcomes already recorded.');
          return page;
        }
        await activeClaim(tx, plan.executeCommandId, principal.tokenId, input);
        const saved = await tx.discordBulkRolePage.update({ where: { id: page.id }, data: { outcomes: json(input.outcomes) } });
        await writeApiAudit(tx, audit, { action: 'discord.bulk.outcomes', resource: 'discord_bulk_role_action', resourceId: value, outcome: 'success', after: { page: input.page } });
        return saved;
      }
      await activeClaim(tx, plan.executeCommandId, principal.tokenId, input);
      await validPlan(tx, plan);
      const bans = await tx.discordModerationCase.findMany({ where: { guildId: plan.guildId, memberId: { in: members }, action: 'ban' }, select: { memberId: true } });
      const blocked = new Set(bans.map(ban => ban.memberId));
      const recorded = page.outcomes as { memberId: string }[] | null;
      return { action: plan.action, guildId: plan.guildId, configRevision: plan.configRevision, roleIds: plan.roleIds, page: page.page, memberIds: members.filter(member => !blocked.has(member) && !recorded?.some(entry => entry.memberId === member)), skippedBanMemberIds: members.filter(member => blocked.has(member)), recordedOutcomes: page.outcomes, nextPage: page.final ? null : page.page + 1, expiresAt: plan.expiresAt };
    }); return apiSuccess(result);
  });
}

/** Shared command guards prevent direct queue acknowledgements bypassing review. */
export async function guardBulkCommand(tx: Prisma.TransactionClient, command: DiscordCommand) {
  const plan = await tx.discordBulkRoleAction.findUnique({ where: { requestKey: (command.payload as { bulkRequestKey: string }).bulkRequestKey } });
  if (!plan) return fail(409, 'Bulk role action no longer exists.');
  await validPlan(tx, plan);
  if (command.kind === 'bulk.preview' ? plan.previewCommandId !== command.id || plan.status !== 'preview_pending' : plan.executeCommandId !== command.id || plan.status !== 'queued') fail(409, 'Bulk command no longer matches the reviewed action.');
}
export async function completeBulkCommand(tx: Prisma.TransactionClient, command: DiscordCommand, success: boolean) {
  const plan = await tx.discordBulkRoleAction.findUnique({ where: { requestKey: (command.payload as { bulkRequestKey: string }).bulkRequestKey } });
  if (!plan) return fail(409, 'Bulk role action no longer exists.');
  if (success) {
    if (command.kind === 'bulk.preview') fail(409, 'Complete a preview by uploading its final snapshot page.');
    const pages = await tx.discordBulkRolePage.findMany({ where: { actionId: plan.id } });
    if (pages.length !== plan.nextPage || pages.some(page => !Array.isArray(page.outcomes) || (page.outcomes as { status: string }[]).some(entry => entry.status === 'failed'))) fail(409, 'All reviewed members require successful or skipped outcomes.');
  }
  await tx.discordBulkRoleAction.update({ where: { id: plan.id }, data: { status: success ? 'succeeded' : 'failed' } });
}
