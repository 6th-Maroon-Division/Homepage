import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '@/lib/prisma';
import { handleApiRequest } from './handler';
import { canAccessApiUser } from './auth';
import { apiError, apiSuccess } from './response';
import { readJsonBody } from './request';
import { parsePositiveId } from './validation';
import { writeApiAudit } from './audit';
import { publishUserProfileEvent } from '@/lib/realtime/user-events';
const maxBytes = 2 * 1024 * 1024;
const uploadDir = path.join(process.cwd(), 'public', 'uploads', 'avatars');
export function avatarExtension(bytes: Buffer, mime: string): string | null {
  if (!bytes.length || bytes.length > maxBytes) return null;
  if (mime === 'image/png' && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'png';
  if (mime === 'image/jpeg' && bytes.subarray(0, 3).equals(Buffer.from([255,216,255]))) return 'jpg';
  if (mime === 'image/gif' && ['GIF87a','GIF89a'].includes(bytes.subarray(0, 6).toString())) return 'gif';
  if (mime === 'image/webp' && bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP') return 'webp';
  return null;
}
export async function userAvatar(request: Request, idValue: string, action: 'upload' | 'refresh' | 'migrate') {
  return handleApiRequest(request, undefined, async (principal, context) => {
    const id = idValue === 'me' && principal.kind === 'user' ? principal.userId : parsePositiveId(idValue);
    if (!id || id > 2147483647 || new URL(request.url).searchParams.size) return apiError(400, 'invalid_request', 'Use a positive Int32 user id (or session-only me) without query parameters.');
    if (!await canAccessApiUser(principal, id, 'user:manage')) return apiError(403, 'forbidden', 'You cannot update this user.');
    const before = await prisma.user.findUnique({ where: { id }, select: { avatarUrl: true } });
    if (!before) return apiError(404, 'not_found', 'User not found.');
    let bytes: Buffer | undefined; let extension: string | null = null; let avatarUrl: string | null = null;
    let providerAccount: { id: number; providerUserId: string } | null = null;
    if (action === 'upload') {
      let form: FormData;
      try { form = await request.formData(); } catch { return apiError(400, 'invalid_request', 'A multipart form with one file is required.'); }
      const file = form.get('file');
      if ([...form.keys()].some(key => key !== 'file') || form.getAll('file').length !== 1 || !file || typeof file === 'string' || file.size > maxBytes) return apiError(422, 'validation_failed', 'Provide exactly one JPEG, PNG, GIF or WebP file, at most 2 MiB.');
      bytes = Buffer.from(await file.arrayBuffer()); extension = avatarExtension(bytes, file.type);
      if (!extension) return apiError(422, 'validation_failed', 'File content must match its supported image type.');
    } else {
      const body = await readJsonBody(request);
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => action !== 'refresh' || key !== 'provider')) return apiError(422, 'validation_failed', action === 'refresh' ? 'Use only provider: steam or discord.' : 'Use an empty JSON object.');
      if (action === 'migrate') {
        if (!before.avatarUrl?.startsWith('data:')) {
          if (principal.kind !== 'user' || principal.userId !== id) await writeApiAudit(prisma, context, { action: 'user_data.read', resource: 'user_avatar', targetUserIds: [id], outcome: 'success' });
          return apiSuccess({ avatarUrl: before.avatarUrl, changed: false });
        }
        const match = /^data:(image\/(?:jpeg|png|gif|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(before.avatarUrl);
        if (!match || match[2].length > Math.ceil(maxBytes / 3) * 4) return apiError(422, 'validation_failed', 'Stored avatar is not a supported image data URL.');
        bytes = Buffer.from(match[2], 'base64'); extension = avatarExtension(bytes, match[1]);
        if (!extension || bytes.toString('base64') !== match[2]) return apiError(422, 'validation_failed', 'Stored avatar has invalid image content.');
      } else {
        const provider = (body as Record<string, unknown>).provider;
        if (provider !== 'steam' && provider !== 'discord') return apiError(422, 'validation_failed', 'provider must be steam or discord.');
        providerAccount = await prisma.authAccount.findFirst({ where: { userId: id, provider }, select: { id: true, providerUserId: true } });
        if (!providerAccount || !/^\d+$/.test(providerAccount.providerUserId)) return apiError(404, 'not_found', 'Linked provider account not found.');
        const secret = provider === 'steam' ? process.env.STEAM_API_KEY : process.env.DISCORD_BOT_TOKEN;
        if (!secret) return apiError(503, 'internal_error', 'Avatar provider is not configured.');
        const providerId = providerAccount.providerUserId;
        const endpoint = provider === 'steam' ? `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?key=${encodeURIComponent(secret)}&steamids=${providerId}` : `https://discord.com/api/v10/users/${providerId}`;
        let response: Response;
        try { response = await fetch(endpoint, { ...(provider === 'discord' ? { headers: { Authorization: `Bot ${secret}` } } : {}), signal: AbortSignal.timeout(10000), redirect: 'error' }); } catch { return apiError(502, 'internal_error', 'Avatar provider could not be reached.'); }
        if (!response.ok) return apiError(502, 'internal_error', 'Avatar provider request failed.');
        let data;
        try { data = await response.json(); } catch { return apiError(502, 'internal_error', 'Avatar provider returned invalid data.'); }
        if (provider === 'discord') {
          if (data?.id !== providerId || (data.avatar != null && (typeof data.avatar !== 'string' || !/^(?:a_)?[a-f0-9]+$/.test(data.avatar)))) return apiError(502, 'internal_error', 'Avatar provider returned invalid data.');
          avatarUrl = data.avatar ? `https://cdn.discordapp.com/avatars/${providerId}/${data.avatar}.${data.avatar.startsWith('a_') ? 'gif' : 'png'}?size=256` : `https://cdn.discordapp.com/embed/avatars/${(BigInt(providerId) >> BigInt(22)) % BigInt(6)}.png`;
        } else {
          const player = data?.response?.players?.find((value: { steamid?: string }) => value?.steamid === providerId);
          avatarUrl = player?.avatarfull || player?.avatarmedium || player?.avatar || null;
          if (!avatarUrl) return apiError(404, 'not_found', 'No provider avatar available.');
          try { const url = new URL(avatarUrl); if (url.protocol !== 'https:' || url.username || url.password) throw Error(); } catch { return apiError(502, 'internal_error', 'Avatar provider returned an invalid URL.'); }
        }
      }
    }
    let filePath: string | undefined; let committed = false;
    try {
      if (bytes && extension) { const filename = `${randomUUID()}.${extension}`; filePath = path.join(uploadDir, filename); await fs.mkdir(uploadDir, { recursive: true }); await fs.writeFile(filePath, bytes, { flag: 'wx' }); avatarUrl = `/uploads/avatars/${filename}`; }
      const result = await prisma.$transaction(async tx => {
        if (!await canAccessApiUser(principal, id, 'user:manage', tx)) return apiError(403, 'forbidden', 'You cannot update this user.');
        if (providerAccount && !await tx.authAccount.findFirst({ where: { id: providerAccount.id, userId: id, providerUserId: providerAccount.providerUserId }, select: { id: true } })) return apiError(409, 'conflict', 'Linked provider account changed.');
        const update = await tx.user.updateMany({ where: { id, avatarUrl: before.avatarUrl }, data: { avatarUrl } });
        if (update.count !== 1) return apiError(409, 'conflict', 'Avatar changed; refresh and try again.');
        await writeApiAudit(tx, context, { action: `user_avatar.${action}`, resource: 'user_avatar', resourceId: String(id), targetUserIds: [id], outcome: 'success', after: { changed: true } });
        return null;
      }, { isolationLevel: 'Serializable' });
      if (result) return result;
      committed = true;
      try { publishUserProfileEvent(id, { source: 'user.avatar_updated' }); } catch { /* Committed response remains successful. */ }
      return apiSuccess({ avatarUrl, changed: true });
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'P2034') return apiError(409, 'conflict', 'Avatar changed; retry the request.');
      throw error;
    } finally { if (filePath && !committed) await fs.unlink(filePath).catch(() => undefined); }
  });
}
