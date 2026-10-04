import type { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import type { PermissionKey } from '@/lib/permissions';
import { handleApiRequest } from '@/lib/api/handler';
import { apiError } from '@/lib/api/response';
import { hasApiPermission } from '@/lib/api/permissions';
import { parseCursorPagination, validateQueryParameters } from '@/lib/api/validation';
import { defaultSettings, DEFAULT_RETENTION, record, type DiscordSettings, type Retention } from '@/lib/discord/config';
import type { ApiPrincipal } from '@/lib/api/principal';
import type { ApiAuditContext } from '@/lib/api/audit';
export class DiscordError extends Error { constructor(public status: number, message: string) { super(message); } }
export const fail = (status: number, message: string): never => { throw new DiscordError(status, message); };
export function demand(principal: ApiPrincipal, ...permissions: PermissionKey[]) { if (!permissions.every(p => hasApiPermission(principal.permissions, p))) fail(403, `Requires ${permissions.join(' and ')}.`); }
export function botOnly(principal: ApiPrincipal): asserts principal is Extract<ApiPrincipal, {kind: 'bot'}> { if (principal.kind !== 'bot') fail(403, 'This endpoint requires an active bot API token.'); }
export function anyDiscord(principal: ApiPrincipal) { if (!hasApiPermission(principal.permissions, 'system:super_admin') && !Object.entries(principal.permissions).some(([k,v]) => k.startsWith('discord:') && (v ?? 0) > 0)) fail(403, 'A Discord administration permission is required.'); }
export function query(request: Request, allowed: string[] = []) { const error = validateQueryParameters(request, allowed); if (error) fail(400, error); }
export function pagination(request: Request, extra: string[] = []) { query(request, ['cursor','limit',...extra]); const p = parseCursorPagination(new URL(request.url).searchParams, { defaultLimit: 30, maxLimit: 100 }); if (p.error) fail(400,p.error); return p.data!; }
export function id(value: string): number { if (!/^[1-9]\d*$/.test(value) || Number(value) > 2147483647) fail(400, 'Invalid resource ID.'); return Number(value); }
export async function body(request: Request, allowed: string[], max = 100000) {
  const text = await request.text(); if (Buffer.byteLength(text) > max) fail(413,'Request is too large.');
  let parsed: unknown; try { parsed = JSON.parse(text); } catch { return fail(400,'Use a JSON object.'); }
  if (!record(parsed) || Object.keys(parsed).some(k => !allowed.includes(k))) fail(422, 'Unknown or invalid fields.');
  return parsed as Record<string, unknown>;
}
export function int(v: unknown, min=0, max=2147483647): v is number { return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max; }
export function text(v: unknown, max=2000): v is string { return typeof v === 'string' && v.length <= max; }
export function instant(v: unknown): Date { if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(v) || !Number.isFinite(Date.parse(v))) fail(422, 'Use an ISO timestamp with timezone.'); return new Date(v as string); }
export function decode(value: unknown): {settings: DiscordSettings; retention: Retention} {
  const v = record(value) ? value : {};
  return { settings: record(v.settings) ? v.settings as DiscordSettings : defaultSettings(), retention: record(v.retention) ? v.retention as Retention : DEFAULT_RETENTION };
}
export async function integration(db: Pick<Prisma.TransactionClient,'discordIntegration'> = prisma) {
  const row = await db.discordIntegration.findUnique({where:{id:1}});
  return { row, ...decode(row?.settings) };
}
export function json(v: unknown) { return v as Prisma.InputJsonValue; }
export async function transaction<T>(fn: (tx: Prisma.TransactionClient)=>Promise<T>) { return prisma.$transaction(fn,{isolationLevel:'Serializable',timeout:30000}); }
export function discordApi(request: Request, permission: PermissionKey | undefined, fn:(p:ApiPrincipal,c:ApiAuditContext)=>Promise<Response>) {
  return handleApiRequest(request,permission,async(p,c)=>{
    try { return await fn(p,c); } catch(e) {
      if(e instanceof DiscordError) return apiError(e.status,e.status===403?'forbidden':e.status===404?'not_found':e.status===409?'conflict':e.status===400?'invalid_request':'validation_failed',e.message);
      if (e && typeof e==='object' && 'code' in e && ['P2002','P2034','P2025'].includes(String(e.code))) return apiError(409,'conflict','State changed. Refresh and retry with current data.');
      throw e;
    }
  }).then(response=>{response.headers.set('Cache-Control','private, no-store');return response;});
}
export const pageResult = <T extends {id:number}>(rows:T[],limit:number) => ({data:rows.slice(0,limit),meta:{nextCursor:rows.length>limit?String(rows[limit-1].id):null,limit}});
