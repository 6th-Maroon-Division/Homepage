import { afterEach, beforeEach, expect, test, vi } from 'vitest';
const db = vi.hoisted(() => ({ attendance: { count: vi.fn(), findMany: vi.fn() }, legacyAttendanceData: { count: vi.fn(), findMany: vi.fn() }, legacyUserData: { findMany: vi.fn() } }));
vi.mock('@/lib/prisma', () => ({ prisma: db }));
import { getTotalAttendanceWithLegacy, getRecentAttendanceWithLegacy, getSixMonthTrendWithLegacy, getUserAttendanceStats, getUserAttendanceRecords, getOrbatAttendance } from '@/lib/attendance-stats';
import { calculateAttendanceStatus, calculateSessionOverlap, calculateSessionOverlapByWindow, calculateTimeDifferences, calculateTimeDifferencesByWindow, calculateTotalMinutesPresent } from '@/lib/attendance';
const date = (time: string) => new Date(`2025-06-15T${time}:00Z`);
beforeEach(() => { vi.resetAllMocks(); vi.useFakeTimers(); vi.setSystemTime(date('18:00')); db.attendance.findMany.mockResolvedValue([]); db.legacyAttendanceData.findMany.mockResolvedValue([]); });
afterEach(() => vi.useRealTimers());

test('display total combines current attendance with applied historic attendance', async () => {
  db.attendance.count.mockResolvedValue(3); db.legacyAttendanceData.count.mockResolvedValue(4); db.legacyUserData.findMany.mockResolvedValue([{ oldData: 5 }, { oldData: 6 }]);
  expect(await getTotalAttendanceWithLegacy(12)).toBe(18);
  expect(db.legacyUserData.findMany).toHaveBeenCalledWith({ where: { mappedUserId: 12, isApplied: true, oldData: { gt: 0 } }, select: { oldData: true } });
});

test('recent history merges sources by operation dates and limits the result', async () => {
  db.attendance.findMany.mockResolvedValue([
    { id: 1, createdAt: date('10:00'), status: 'present', orbat: { name: 'UTC operation', startsAtUtc: date('15:00'), eventDate: date('14:00') } },
    { id: 2, createdAt: date('11:00'), status: 'late', orbat: { name: 'Legacy schedule', startsAtUtc: null, eventDate: date('16:00') } },
    { id: 3, createdAt: date('12:00'), status: 'absent', orbat: null },
  ]);
  db.legacyAttendanceData.findMany.mockResolvedValue([{ id: 4, legacyEventDate: date('17:00'), legacyStatus: 'P' }, { id: 5, legacyEventDate: null, legacyStatus: 'P' }]);
  expect((await getRecentAttendanceWithLegacy(12)).map(row => row.id)).toEqual([5, 4, 2, 1, 3]);
  expect((await getRecentAttendanceWithLegacy(12, 2)).map(row => row.id)).toEqual([5, 4]);
  const all = await getRecentAttendanceWithLegacy(12);
  expect(all.find(row => row.id === 3)).toMatchObject({ orbatName: 'Unknown ORBAT', orbatDate: date('12:00'), isLegacy: false });
  expect(all[0]).toMatchObject({ orbatDate: date('18:00'), createdAt: date('18:00'), isLegacy: true });
});

test('six-month trend queries the current system and returns its dates', async () => {
  db.attendance.findMany.mockResolvedValue([{ createdAt: date('10:00') }]);
  expect(await getSixMonthTrendWithLegacy(12)).toEqual([date('10:00')]);
  const query = db.attendance.findMany.mock.lastCall![0];
  expect(query.where.userId).toBe(12); expect(query.where.createdAt.gte.getMonth()).toBe(0); expect(query.where.createdAt.gte.getDate()).toBe(1);
  expect(db.legacyAttendanceData.findMany).not.toHaveBeenCalled();
});

test('attendance statistics distinguish statuses and monthly rates including an empty period', async () => {
  expect(await getUserAttendanceStats(12)).toMatchObject({ totalEvents: 0, attendancePercentage: 0, avgMinutesMissed: 0 });
  db.attendance.findMany.mockResolvedValue(['present', 'late', 'gone_early', 'partial', 'absent', 'no_show'].map((status, index) => ({ status, minutesLate: index === 1 || index === 3 ? 10 : 0, minutesGoneEarly: index === 2 || index === 3 ? 20 : 0, totalMinutesMissed: index * 10 })));
  expect(await getUserAttendanceStats(12, 60)).toEqual({ totalEvents: 6, presentCount: 1, lateCount: 1, goneEarlyCount: 1, arrivedLateCount: 2, leftEarlyCount: 2, partialCount: 1, absentCount: 1, noShowCount: 1, attendancePercentage: 67, avgMinutesMissed: 25, avgArrivedLatePerMonth: 1, avgLeftEarlyPerMonth: 1 });
});

test('record queries support optional periods, limits and operation user filters', async () => {
  await getUserAttendanceRecords(12);
  expect(db.attendance.findMany.mock.lastCall![0]).toMatchObject({ where: { userId: 12 }, take: 50 });
  expect(db.attendance.findMany.mock.lastCall![0].where).not.toHaveProperty('createdAt');
  await getUserAttendanceRecords(12, 5, 3);
  expect(db.attendance.findMany.mock.lastCall![0]).toMatchObject({ where: { userId: 12, createdAt: { gte: new Date('2025-06-10T18:00:00Z') } }, take: 3 });
  await getOrbatAttendance(20); expect(db.attendance.findMany.mock.lastCall![0].where).toEqual({ orbatId: 20 });
  await getOrbatAttendance(20, 12); expect(db.attendance.findMany.mock.lastCall![0].where).toEqual({ orbatId: 20, userId: 12 });
});

test.each([
  [false, 0, 0, 0, true, 'absent'], [false, 0, 0, 0, false, 'no_show'], [true, 10, 10, 20, false, 'present'],
  [true, 30, 30, 60, false, 'partial'], [true, 60, 0, 60, false, 'late'], [true, 0, 60, 60, false, 'gone_early'],
] as const)('attendance classification respects overrides and sixty-minute boundary %#', (checkin, late, early, missed, absent, expected) => expect(calculateAttendanceStatus(checkin, late, early, missed, absent)).toBe(expected));
test('attendance classification defaults to ordinary present attendance', () => expect(calculateAttendanceStatus(true, 0, 0, 0)).toBe('present'));

test('session overlap rejects invalid/outside windows and clips at UTC boundaries', () => {
  const outside = { countedCheckinAt: null, countedCheckoutAt: null, isWithinWindow: false };
  expect(calculateSessionOverlapByWindow(date('10:00'), null, date('12:00'), date('12:00'))).toEqual(outside);
  expect(calculateSessionOverlapByWindow(date('09:00'), date('09:30'), date('10:00'), date('14:00'))).toEqual(outside);
  expect(calculateSessionOverlapByWindow(date('15:00'), null, date('10:00'), date('14:00'))).toEqual(outside);
  expect(calculateSessionOverlap(date('09:00'), date('15:00'), '10:00', '14:00', date('00:00'))).toEqual({ countedCheckinAt: date('10:00'), countedCheckoutAt: date('14:00'), isWithinWindow: true });
  expect(calculateSessionOverlapByWindow(date('11:00'), date('13:00'), date('10:00'), date('14:00'))).toEqual({ countedCheckinAt: date('11:00'), countedCheckoutAt: date('13:00'), isWithinWindow: true });
  expect(calculateSessionOverlapByWindow(date('11:00'), null, date('10:00'), date('14:00'))).toMatchObject({ countedCheckoutAt: null, isWithinWindow: true });
});

test('time differences use grace hours, ceiling and caps while missing schedules return zero', () => {
  const zero = { minutesLate: 0, minutesGoneEarly: 0, totalMinutesMissed: 0 };
  expect(calculateTimeDifferences(null, '14:00', null, null, date('00:00'))).toEqual(zero);
  expect(calculateTimeDifferences('10:00', null, null, null, date('00:00'))).toEqual(zero);
  expect(calculateTimeDifferences('10:00', '14:00', null, null, null)).toEqual(zero);
  expect(calculateTimeDifferencesByWindow(null, date('14:00'), null, null)).toEqual(zero);
  expect(calculateTimeDifferencesByWindow(date('10:00'), null, null, null)).toEqual(zero);
  expect(calculateTimeDifferencesByWindow(date('14:00'), date('10:00'), null, null)).toEqual(zero);
  expect(calculateTimeDifferences('10:00', '14:00', null, null, date('00:00'))).toEqual(zero);
  expect(calculateTimeDifferences('10:00', '14:00', date('10:30'), date('13:30'), date('00:00'))).toEqual(zero);
  expect(calculateTimeDifferences('10:00', '14:00', date('12:30'), date('11:30'), date('00:00'))).toEqual({ minutesLate: 60, minutesGoneEarly: 60, totalMinutesMissed: 120 });
  expect(calculateTimeDifferences('10:00', '14:00', new Date('2025-06-15T11:00:01Z'), new Date('2025-06-15T12:59:59Z'), date('00:00'))).toEqual({ minutesLate: 1, minutesGoneEarly: 1, totalMinutesMissed: 2 });
  expect(calculateTotalMinutesPresent([{ countedCheckinAt: date('10:00'), countedCheckoutAt: date('11:00') }, { countedCheckinAt: date('12:00'), countedCheckoutAt: null }])).toBe(60);
  expect(calculateTotalMinutesPresent([])).toBe(0);
});
