import { prisma } from '@/lib/prisma';
import type { Prisma } from '@/generated/prisma/client';
import type { ApiPrincipal } from './principal';
import { writeApiAudit, type ApiAuditContext } from './audit';
import { apiSuccess } from './response';
import { readJsonBody } from './request';
import { parseCursorPagination } from './validation';
import { isDateOnly } from './utc';
import { rejectAttendance as fail } from './attendance';
import { parseLegacyCsv } from './legacy-csv';
const include = { mappedUser: { select: { id: true, username: true, avatarUrl: true } } } as const;
type Row = Prisma.LegacyAttendanceDataGetPayload<{ include: typeof include }>;
function dto(row: Row) { return { ...row, legacyEventDate: row.legacyEventDate?.toISOString() ?? null, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() }; }
function query(request: Request, allowed: string[]) { const params = new URL(request.url).searchParams; for (const key of params.keys()) if (!allowed.includes(key) || params.getAll(key).length !== 1) fail(400, 'Unknown or repeated query argument.'); return params; }
function object(value: unknown, allowed: string[]): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) fail(422, 'Invalid payload fields.'); return value as Record<string, unknown>; }
async function readAudit(principal: ApiPrincipal, audit: ApiAuditContext, rows: { mappedUserId: number | null }[]) {
  const targets = [...new Set(rows.flatMap(row => row.mappedUserId !== null && (principal.kind === 'bot' || row.mappedUserId !== principal.userId) ? [row.mappedUserId] : []))];
  if (targets.length || rows.some(row => row.mappedUserId === null)) await writeApiAudit(prisma, audit, { action: 'user_data.read', resource: 'legacy_attendance', targetUserIds: targets, outcome: 'success' });
}
export async function listLegacyAttendance(request: Request, principal: ApiPrincipal, audit: ApiAuditContext) {
  const params = query(request, ['cursor','limit','search','isMapped']); const page = parseCursorPagination(params, { defaultLimit: 50, maxLimit: 100 }); if (page.error !== undefined) fail(400, page.error);
  const { cursor, limit } = page.data;
  if (params.has('isMapped') && !['true','false'].includes(params.get('isMapped')!)) fail(400, 'isMapped must be true or false.');
  const search = params.get('search')?.trim(); if (search && search.length > 200) fail(400, 'search must be at most 200 characters.');
  const where: Prisma.LegacyAttendanceDataWhereInput = { ...(cursor ? { id: { gt: cursor } } : {}), ...(search ? { legacyName: { contains: search, mode: 'insensitive' } } : {}), ...(params.has('isMapped') ? { isMapped: params.get('isMapped') === 'true' } : {}) };
  const rows = await prisma.legacyAttendanceData.findMany({ where, include, orderBy: { id: 'asc' }, take: limit + 1 }); const returned = rows.slice(0, limit); await readAudit(principal, audit, returned);
  return apiSuccess(returned.map(dto), { meta: { limit, nextCursor: rows.length > limit ? String(returned.at(-1)!.id) : null } });
}
export async function mapLegacyAttendance(request: Request, _principal: ApiPrincipal, audit: ApiAuditContext, id: number) {
  query(request, []); const body = object(await readJsonBody(request), ['mappedUserId']); const userId = body.mappedUserId;
  if (userId !== null && (typeof userId !== 'number' || !Number.isInteger(userId) || userId < 1 || userId > 2147483647)) fail(422, 'mappedUserId must be a positive 32-bit integer or null.');
  const updated = await prisma.$transaction(async tx => {
    const before = await tx.legacyAttendanceData.findUnique({ where: { id } }); if (!before) fail(404, 'Legacy record not found.');
    if (userId !== null && !await tx.user.findUnique({ where: { id: userId }, select: { id: true } })) fail(404, 'User not found.');
    const after = await tx.legacyAttendanceData.update({ where: { id }, data: { mappedUserId: userId, isMapped: userId !== null }, include });
    await writeApiAudit(tx, audit, { action: 'legacy_attendance.mapping_updated', resource: 'legacy_attendance', resourceId: String(id), targetUserIds: [...new Set([before.mappedUserId, userId].filter((value): value is number => value !== null))], before: { mappedUserId: before.mappedUserId, isMapped: before.isMapped }, after: { mappedUserId: after.mappedUserId, isMapped: after.isMapped }, outcome: 'success' });
    return after;
  }, { isolationLevel: 'Serializable' });
  return apiSuccess(dto(updated));
}
export function parseAttendanceMatrix(csvData: unknown) {
  const rows = parseLegacyCsv(csvData); const yearMatch = rows.slice(0, 5).flat().join(' ').match(/YEAR:\s*(\d{4})\b/i); if (!yearMatch) fail(422, 'CSV must contain an explicit YEAR: YYYY header.');
  const year = Number(yearMatch[1]); if (year < 1900 || year > 9999) fail(422, 'Invalid matrix year.');
  const headerIndex = rows.slice(0, 10).findIndex(row => row.some(cell => cell.toLowerCase() === 'name')); if (headerIndex < 0) fail(422, 'Missing NAME header.');
  const header = rows[headerIndex].map(cell => cell.toLowerCase()); const rankIndex = header.indexOf('rank'), nameIndex = header.indexOf('name'), idIndex = header.indexOf('id'); if (rankIndex < 0) fail(422, 'Missing RANK header.');
  const months = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
  const columns = header.flatMap((cell, index) => { const match = cell.match(/^(\d{1,2})-(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)$/); return match ? [{ index, day: Number(match[1]), month: months.indexOf(match[2]) + 1 }] : []; });
  if (!columns.length) fail(422, 'No date columns found.');
  let wrap = -1; for (let i = 1; i < columns.length; i++) if (columns[i].month < columns[i - 1].month) { if (wrap !== -1) fail(422, 'Ambiguous matrix year rollover.'); wrap = i; }
  const dated = columns.map((column, index) => { const date = `${wrap !== -1 && index < wrap ? year - 1 : year}-${String(column.month).padStart(2,'0')}-${String(column.day).padStart(2,'0')}`; if (!isDateOnly(date)) fail(422, 'Invalid matrix calendar date.'); return { ...column, date }; });
  if (new Set(dated.map(column => column.date)).size !== dated.length) fail(422, 'Duplicate date columns.');
  const records: { legacyName: string; legacyUserId: string | null; legacyStatus: string; legacyEventDate: Date; legacyNotes: string | null }[] = []; let processedCells = 0, skippedCells = 0;
  for (const row of rows.slice(headerIndex + 1)) {
    const rank = row[rankIndex]?.trim(), name = row[nameIndex]?.trim(); if (!name || !rank) continue;
    for (const column of dated) {
      const status = row[column.index]?.trim().toUpperCase() ?? ''; processedCells++;
      if (['','LOA','NO','EO'].includes(status)) { skippedCells++; continue; }
      if (!['P','A','NA'].includes(status)) fail(422, 'Unrecognized matrix status.');
      records.push({ legacyName: `${rank} ${name}`, legacyUserId: idIndex < 0 ? null : row[idIndex]?.trim() || null, legacyStatus: status, legacyEventDate: new Date(`${column.date}T00:00:00Z`), legacyNotes: `Imported from ${column.date} attendance` });
      if (records.length > 5000) fail(422, 'Import at most 5000 attendance cells at a time.');
    }
  }
  if (!records.length) fail(422, 'No P/A/NA attendance cells found.');
  return { records, year, dateColumns: dated.length, processedCells, skippedCells };
}
export async function importLegacyAttendance(request: Request, principal: ApiPrincipal, audit: ApiAuditContext) {
  query(request, []); const body = object(await readJsonBody(request), ['csvData','previewOnly']); if (body.previewOnly !== undefined && typeof body.previewOnly !== 'boolean') fail(422, 'previewOnly must be boolean.');
  const parsed = parseAttendanceMatrix(body.csvData);
  const result = await prisma.$transaction(async tx => {
    const pending: typeof parsed.records = [], conflicts: { legacyUserId: string | null; legacyEventDate: string; existing: string; new: string }[] = []; let same = 0;
    const seen = new Map<string,string>(); const readRows: { mappedUserId: number | null }[] = [];
    for (const record of parsed.records) {
      const key = JSON.stringify([record.legacyUserId ?? record.legacyName, record.legacyEventDate.toISOString()]);
      const existing = await tx.legacyAttendanceData.findMany({ where: { ...(record.legacyUserId ? { legacyUserId: record.legacyUserId } : { legacyUserId: null, legacyName: record.legacyName }), legacyEventDate: record.legacyEventDate }, select: { legacyStatus: true, mappedUserId: true } }); readRows.push(...existing);
      const previous = [...new Set([...existing.map(row => row.legacyStatus), ...(seen.has(key) ? [seen.get(key)!] : [])])];
      if (previous.some(status => status !== record.legacyStatus)) { conflicts.push({ legacyUserId: record.legacyUserId, legacyEventDate: record.legacyEventDate.toISOString(), existing: previous.join(','), new: record.legacyStatus }); continue; }
      if (previous.length) { same++; continue; }
      seen.set(key, record.legacyStatus); pending.push(record);
    }
    const summary = { imported: pending.length, year: parsed.year, dateColumns: parsed.dateColumns, skippedCells: parsed.skippedCells, processedCells: parsed.processedCells, duplicates: { same, different: conflicts.length }, conflicts, preview: body.previewOnly ? pending.map(record => ({ ...record, legacyEventDate: record.legacyEventDate.toISOString() })) : [] };
    if (body.previewOnly) {
      const targets = [...new Set(readRows.flatMap(row => row.mappedUserId !== null && (principal.kind === 'bot' || principal.userId !== row.mappedUserId) ? [row.mappedUserId] : []))];
      if (targets.length || readRows.some(row => row.mappedUserId === null)) await writeApiAudit(tx, audit, { action: 'user_data.read', resource: 'legacy_attendance', targetUserIds: targets, outcome: 'success' });
      return summary;
    }
    if (conflicts.length) fail(409, 'Conflicting attendance exists. Correct the CSV before importing.');
    if (pending.length) {
      const created = await tx.legacyAttendanceData.createManyAndReturn({ data: pending, select: { id: true } });
      await writeApiAudit(tx, audit, { action: 'legacy_attendance.imported', resource: 'legacy_attendance', outcome: 'success', before: {}, after: { recordIds: created.map(row => row.id), importedCount: pending.length, year: parsed.year, dateColumnCount: parsed.dateColumns } });
    }
    return summary;
  }, { isolationLevel: 'Serializable', timeout: 30000 });
  return apiSuccess(result);
}
