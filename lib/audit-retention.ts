import type { PrismaClient } from '@/generated/prisma/client';
const retentionMs = 365 * 24 * 60 * 60 * 1000;
/** Operational maintenance only; no HTTP endpoint can delete audit records. */
export async function pruneExpiredApiAudits(database: Pick<PrismaClient, 'apiAuditLog'>, options: { apply?: boolean; now?: Date } = {}) {
  const now = options.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new Error('Retention requires a valid clock.');
  const cutoff = new Date(now.getTime() - retentionMs);
  const where = { occurredAt: { lt: cutoff } };
  const eligibleCount = await database.apiAuditLog.count({ where });
  let deletedCount = 0;
  if (options.apply) {
    while (true) {
      const rows = await database.apiAuditLog.findMany({ where, select: { id: true }, orderBy: { id: 'asc' }, take: 1000 });
      if (!rows.length) break;
      const removed = await database.apiAuditLog.deleteMany({ where: { ...where, id: { in: rows.map(row => row.id) } } });
      deletedCount += removed.count;
      if (removed.count === 0) break;
    }
  }
  return { applied: options.apply === true, cutoff: cutoff.toISOString(), eligibleCount, deletedCount };
}
