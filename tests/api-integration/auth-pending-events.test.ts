import { afterAll, expect, test, vi } from 'vitest';
import type { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import { processPendingEventsForUser } from '@/lib/pending-events';
afterAll(async () => { await prisma.$disconnect(); });
test('verified account linking claims only eligible pending events and writes metadata-only actor audit', async () => {
  const user = await prisma.user.create({ data: { username: 'Auth pending attendance user' } });
  const other = await prisma.user.create({ data: { username: 'Auth pending attendance other' } });
  const steamId = '76561500000000001';
  const first = await prisma.attendanceEvent.create({ data: { steamId, isJoin: true, eventTime: new Date('2026-01-01T00:00:00Z') } });
  const duplicate = await prisma.attendanceEvent.create({ data: { steamId, isJoin: true, eventTime: new Date('2026-01-01T00:01:00Z') } });
  const leave = await prisma.attendanceEvent.create({ data: { steamId, isJoin: false, eventTime: new Date('2026-01-01T00:02:00Z') } });
  const owned = await prisma.attendanceEvent.create({ data: { steamId, userId: other.id, isJoin: false, eventTime: new Date('2026-01-01T00:03:00Z') } });
  const unrelated = await prisma.attendanceEvent.create({ data: { steamId: '76561500000000002', isJoin: true, eventTime: new Date() } });
  const context = { principal: { kind: 'user' as const, userId: user.id, permissions: {} }, correlationId: 'auth-pending-integration-1', method: 'GET', path: '/api/auth/steam-callback' };
  expect(await processPendingEventsForUser(steamId, null, user.id, context)).toEqual({ processedCount: 2 });
  for (const id of [first.id, duplicate.id, leave.id]) expect(await prisma.attendanceEvent.findUniqueOrThrow({ where: { id } })).toMatchObject({ userId: user.id, processed: true });
  expect(await prisma.attendanceEvent.findUniqueOrThrow({ where: { id: owned.id } })).toMatchObject({ userId: other.id, processed: false });
  expect(await prisma.attendanceEvent.findUniqueOrThrow({ where: { id: unrelated.id } })).toMatchObject({ userId: null, processed: false });
  const audit = await prisma.apiAuditLog.findFirstOrThrow({ where: { correlationId: context.correlationId } });
  expect(audit).toMatchObject({ actorType: 'user', actorUserId: user.id, targetUserIds: [user.id], after: { eventIds: [first.id, duplicate.id, leave.id], linkedCount: 3 } });
  expect(JSON.stringify(audit)).not.toContain(steamId);
  expect(await processPendingEventsForUser(steamId, null, user.id, context)).toEqual({ processedCount: 0 });
  expect(await prisma.apiAuditLog.count({ where: { correlationId: context.correlationId } })).toBe(1);
});
test('audit failure rolls back real event linkage and successful standalone retry uses system actor', async () => {
  const user = await prisma.user.create({ data: { username: 'Auth pending rollback user' } });
  const discordId = '76561500000000003';
  const row = await prisma.attendanceEvent.create({ data: { discordId, isJoin: true, eventTime: new Date() } });
  const transaction = prisma.$transaction.bind(prisma);
  const spy = vi.spyOn(prisma, '$transaction').mockImplementation(((operation: (tx: Prisma.TransactionClient) => Promise<unknown>, options?: { isolationLevel?: Prisma.TransactionIsolationLevel; timeout?: number }) => transaction(async tx => {
    const fail = vi.spyOn(tx.apiAuditLog, 'create').mockRejectedValue(new Error('Audit unavailable'));
    try { return await operation(tx); } finally { fail.mockRestore(); }
  }, options)) as typeof prisma.$transaction);
  try { await expect(processPendingEventsForUser(null, discordId, user.id)).rejects.toThrow('Audit unavailable'); } finally { spy.mockRestore(); }
  expect(await prisma.attendanceEvent.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ userId: null, processed: false });
  expect(await processPendingEventsForUser(null, discordId, user.id)).toEqual({ processedCount: 1 });
  expect(await prisma.apiAuditLog.findFirst({ where: { action: 'attendance_events.linked', targetUserIds: { has: user.id } } })).toMatchObject({ actorType: 'system', actorUserId: null });
});
