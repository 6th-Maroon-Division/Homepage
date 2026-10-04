import { createHash } from 'node:crypto';
import type { Prisma } from '@/generated/prisma/client';
import { apiError, apiSuccess } from '@/lib/api/response';
import { writeApiAudit } from '@/lib/api/audit';
import { resolveOrbatScheduleWindow } from '@/lib/orbat-schedule';
import { snowflake } from '@/lib/discord/config';
import { body, botOnly, discordApi, fail, id, integration, query, transaction } from './shared';

/** Deliberately excludes availability notes, attendance and unrelated user fields. */
const renderSelect = {
  id: true, name: true, description: true, eventDate: true, startTime: true, endTime: true,
  startsAtUtc: true, endsAtUtc: true, timezone: true, isSideOp: true,
  bluforCountry: true, bluforRelationship: true, opforCountry: true, opforRelationship: true,
  indepCountry: true, indepRelationship: true, iedThreat: true, civilianRelationship: true,
  rulesOfEngagement: true, airspace: true, inGameTimezone: true, operationDay: true,
  squads: { orderBy: [{ orderIndex: 'asc' }, { id: 'asc' }], select: {
    id: true, name: true, orderIndex: true,
    slots: { orderBy: [{ orderIndex: 'asc' }, { id: 'asc' }], select: {
      id: true, orderIndex: true, maxSignups: true,
      squadRole: { select: { id: true, name: true, requiredTrainingIds: true, requiredRankIds: true } },
      signups: { orderBy: { id: 'asc' }, select: { id: true, user: { select: {
        id: true, username: true, userRank: { select: { currentRank: { select: { name: true, abbreviation: true } } } },
      } } } },
    } },
  } },
} satisfies Prisma.OrbatSelect;

async function snapshot(tx: Prisma.TransactionClient, orbatId: number) {
  const announcement = await tx.discordAnnouncement.findUnique({ where: { orbatId } });
  if (!announcement?.messageId) fail(409, 'Publish and confirm an announcement before automatic reconciliation.');
  const { settings, row } = await integration(tx);
  if (!settings.announcementsEnabled) fail(409, 'Announcements are disabled.');
  const pending = await tx.discordCommand.findFirst({ where: { kind: { startsWith: 'announcement.' }, status: { in: ['pending', 'running'] }, payload: { path: ['orbatId'], equals: orbatId } } });
  if (pending) fail(409, 'Wait for the explicit announcement command to finish before automatic reconciliation.');
  const orbat = await tx.orbat.findUnique({ where: { id: orbatId }, select: renderSelect });
  if (!orbat) fail(404, 'ORBAT not found.');
  const cutoff = resolveOrbatScheduleWindow(orbat!).cutoff;
  const closed = !!cutoff && cutoff < new Date();
  const baseUrl = String(settings.websiteUrl).replace(/\/$/, '');
  const content = {
    schemaVersion: 1,
    // Including the saved configuration revision invalidates rendering after configuration changes.
    configRevision: row!.revision,
    missionText: announcement!.missionText,
    orbatUrl: `${baseUrl}/orbats/${orbatId}`,
    orbat,
    colors: { available: settings.availableColor, partial: settings.partialColor, full: settings.fullColor },
    controls: { signup: !!settings.signupEnabled && !closed, availability: !!settings.availabilityEnabled && !closed, closed, cutoff },
  };
  const contentRevision = createHash('sha256').update(JSON.stringify(content)).digest('hex');
  return { announcement: announcement!, content, contentRevision };
}

export function announcementRender(request: Request, value: string, method: 'GET' | 'POST') {
  return discordApi(request, undefined, async (principal, audit) => {
    botOnly(principal); query(request); const orbatId = id(value);
    const input = method === 'POST' ? await body(request, ['channelId', 'messageId', 'contentRevision', 'outcome']) : null;
    if (input && (!snowflake(input.channelId) || !snowflake(input.messageId) || typeof input.contentRevision !== 'string' || !/^[a-f0-9]{64}$/.test(input.contentRevision) || !['updated', 'missing'].includes(String(input.outcome)))) fail(422, 'A target, content revision and updated/missing outcome are required.');
    const result = await transaction(async tx => {
      const current = await snapshot(tx, orbatId);
      const { announcement, content, contentRevision } = current;
      if (input) {
        if (announcement.channelId !== input.channelId || announcement.messageId !== input.messageId) fail(409, 'Announcement message changed. Fetch a fresh snapshot.');
        if (contentRevision !== input.contentRevision) {
          // A stale remote edit may have overwritten a newer Discord message. Force
          // reconciliation even if an earlier acknowledgement matched current content.
          await tx.discordAnnouncement.update({ where: { orbatId }, data: { renderedRevision: null } });
          await writeApiAudit(tx, audit, { action: 'discord.announcement.stale_render', resource: 'discord_announcement', resourceId: String(announcement.id), outcome: 'success' });
          return { stale: true as const };
        }
        if (input.outcome === 'updated' && announcement.missingAt) fail(409, 'A missing announcement requires an explicit staff repost.');
        const replay = input.outcome === 'missing' ? !!announcement.missingAt : announcement.renderedRevision === contentRevision;
        const saved = replay ? announcement : await tx.discordAnnouncement.update({ where: { orbatId }, data: input.outcome === 'missing' ? { missingAt: new Date() } : { renderedRevision: contentRevision, lastRenderedAt: new Date() } });
        await writeApiAudit(tx, audit, { action: 'discord.announcement.render_reported', resource: 'discord_announcement', resourceId: String(announcement.id), outcome: 'success', after: { outcome: input.outcome, contentRevision } });
        return { channelId: saved.channelId, messageId: saved.messageId, renderedRevision: saved.renderedRevision, lastRenderedAt: saved.lastRenderedAt, missingAt: saved.missingAt };
      }
      const targetUserIds = [...new Set(content.orbat!.squads.flatMap(squad => squad.slots.flatMap(slot => slot.signups.map(signup => signup.user.id))))];
      if (targetUserIds.length) await writeApiAudit(tx, audit, { action: 'user_data.read', resource: 'discord_announcement', resourceId: String(announcement.id), targetUserIds, outcome: 'success' });
      return {
        channelId: announcement.channelId, messageId: announcement.messageId,
        contentRevision, renderedRevision: announcement.renderedRevision,
        lastRenderedAt: announcement.lastRenderedAt, missingAt: announcement.missingAt,
        needsUpdate: !announcement.missingAt && announcement.renderedRevision !== contentRevision,
        // Automatic edits never generate another ping, even when the original publication did.
        allowedMentions: { parse: [], users: [], roles: [], replied_user: false },
        // This is a live image, not an immutable artifact. Fetch just before editing;
        // the receipt rechecks the current revision and rejects intervening changes.
        imageUrl: `${content.orbatUrl}/opengraph-image?revision=${contentRevision}`,
        content,
      };
    });
    if ('stale' in result) return apiError(409, 'conflict', 'Announcement content changed. Fetch and render the latest snapshot again.');
    return apiSuccess(result);
  });
}
