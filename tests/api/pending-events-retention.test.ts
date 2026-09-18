import { beforeEach, expect, test, vi } from 'vitest';
const m = vi.hoisted(() => ({ db: { attendanceEvent: { findMany: vi.fn(), updateMany: vi.fn() }, apiAuditLog: { create: vi.fn() }, $transaction: vi.fn() } }));
vi.mock('@/lib/prisma', () => ({ prisma: m.db }));
import { processPendingEventsForUser } from '@/lib/pending-events';
import { pruneExpiredApiAudits } from '@/lib/audit-retention';
beforeEach(() => { vi.resetAllMocks(); m.db.$transaction.mockImplementation(cb => cb(m.db)); m.db.attendanceEvent.findMany.mockResolvedValue([]); m.db.attendanceEvent.updateMany.mockResolvedValue({ count: 1 }); });
test('absent identities avoid any transaction', async () => {
 expect(await processPendingEventsForUser(null, undefined, 1)).toEqual({ processedCount: 0 }); expect(m.db.$transaction).not.toHaveBeenCalled();
});
test('links only claimed events and collapses successive equal event types for processed count', async () => {
 m.db.attendanceEvent.findMany.mockResolvedValue([{ id: 1, isJoin: true }, { id: 2, isJoin: true }, { id: 3, isJoin: true }, { id: 4, isJoin: false }]);
 m.db.attendanceEvent.updateMany.mockResolvedValueOnce({ count: 0 });
 expect(await processPendingEventsForUser('steam', 'discord', 5)).toEqual({ processedCount: 2 });
 expect(m.db.apiAuditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ actorType: 'system', after: { eventIds: [2, 3, 4], linkedCount: 3 } }) });
});
test('empty lists do not audit and explicit actor context attributes linked events', async () => {
 expect(await processPendingEventsForUser(null, 'discord', 5)).toEqual({ processedCount: 0 }); expect(m.db.apiAuditLog.create).not.toHaveBeenCalled();
 m.db.attendanceEvent.findMany.mockResolvedValue([{ id: 1, isJoin: false }]);
 await processPendingEventsForUser('steam', null, 5, { principal: { kind: 'user', userId: 5, permissions: {} }, correlationId: 'link', method: 'GET', path: '/api/auth/steam-callback' });
 expect(m.db.apiAuditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ actorType: 'user', actorUserId: 5, correlationId: 'link' }) });
});
test('retention defaults to dry run and rejects invalid dates', async () => {
 const db = { apiAuditLog: { count: vi.fn().mockResolvedValue(3), findMany: vi.fn(), deleteMany: vi.fn() } };
 expect(await pruneExpiredApiAudits(db as never)).toMatchObject({ applied: false, eligibleCount: 3, deletedCount: 0 });
 expect(db.apiAuditLog.deleteMany).not.toHaveBeenCalled();
 await expect(pruneExpiredApiAudits(db as never, { now: new Date('invalid') })).rejects.toThrow('valid clock');
});
test('retention stops if a racing deletion makes no progress, bounding the maintenance loop', async () => {
 const db = { apiAuditLog: { count: vi.fn().mockResolvedValue(2), findMany: vi.fn().mockResolvedValue([{ id: 1 }, { id: 2 }]), deleteMany: vi.fn().mockResolvedValue({ count: 0 }) } };
 expect(await pruneExpiredApiAudits(db as never, { apply: true, now: new Date('2026-09-18T00:00:00Z') })).toEqual({ applied: true, cutoff: '2025-09-18T00:00:00.000Z', eligibleCount: 2, deletedCount: 0 });
 expect(db.apiAuditLog.findMany).toHaveBeenCalledTimes(1);
 db.apiAuditLog.findMany.mockResolvedValueOnce([{ id: 1 }]).mockResolvedValueOnce([]);
 db.apiAuditLog.deleteMany.mockResolvedValue({ count: 1 });
 expect((await pruneExpiredApiAudits(db as never, { apply: true })).deletedCount).toBe(1);
});
