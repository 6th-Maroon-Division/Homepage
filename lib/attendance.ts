import { AttendanceStatus } from '@/generated/prisma/enums';

/**
 * Calculate attendance status based on time tracking
 * Status is determined by:
 * - present: Full attendance with no missing time
 * - late: Arrived after first hour
 * - gone_early: Left before last hour
 * - partial: Both late and gone_early with >= 60 mins total missed
 * - no_show: Never checked in
 * - absent: Manually marked as absent
 */
export function calculateAttendanceStatus(
  hasCheckIn: boolean,
  minutesLate: number,
  minutesGoneEarly: number,
  totalMinutesMissed: number,
  isManuallyMarkedAbsent: boolean = false
): AttendanceStatus {
  // If manually marked absent, return absent
  if (isManuallyMarkedAbsent) {
    return 'absent';
  }

  // If never checked in, it's a no_show
  if (!hasCheckIn) {
    return 'no_show';
  }

  // If checked in, determine partial vs late vs gone_early vs present
  if (totalMinutesMissed >= 60) {
    return 'partial';
  }

  if (minutesLate > 0 && minutesGoneEarly > 0) {
    return 'partial'; // Just in case total is < 60 but both conditions exist
  }

  if (minutesLate > 0) {
    return 'late';
  }

  if (minutesGoneEarly > 0) {
    return 'gone_early';
  }

  return 'present';
}

/**
 * Calculate the overlap between session times and orbat window
 * Returns the actual times that count towards attendance (clipped to orbat window)
 */
export function calculateSessionOverlap(
  sessionCheckinAt: Date,
  sessionCheckoutAt: Date | null,
  orbatStartTime: string,
  orbatEndTime: string,
  orbatEventDate: Date
): {
  countedCheckinAt: Date | null;
  countedCheckoutAt: Date | null;
  isWithinWindow: boolean;
} {
  const [startHour, startMinute] = orbatStartTime.split(':').map(Number);
  const [endHour, endMinute] = orbatEndTime.split(':').map(Number);

  const orbatStart = new Date(orbatEventDate);
  orbatStart.setHours(startHour, startMinute, 0, 0);

  const orbatEnd = new Date(orbatEventDate);
  orbatEnd.setHours(endHour, endMinute, 0, 0);

  // If session is completely outside orbat window, return null
  if (sessionCheckoutAt && sessionCheckoutAt < orbatStart) {
    // Checked out before orbat starts
    return {
      countedCheckinAt: null,
      countedCheckoutAt: null,
      isWithinWindow: false,
    };
  }

  if (sessionCheckinAt > orbatEnd) {
    // Checked in after orbat ends
    return {
      countedCheckinAt: null,
      countedCheckoutAt: null,
      isWithinWindow: false,
    };
  }

  // Calculate overlap
  const countedCheckinAt =
    sessionCheckinAt < orbatStart ? orbatStart : sessionCheckinAt;
  const countedCheckoutAt =
    sessionCheckoutAt === null
      ? null
      : sessionCheckoutAt > orbatEnd
      ? orbatEnd
      : sessionCheckoutAt;

  return {
    countedCheckinAt,
    countedCheckoutAt,
    isWithinWindow: true,
  };
}

/**
 * Calculate time differences for attendance based on sessions
 * Only counts time within the orbat window
 */
export function calculateTimeDifferences(
  orbatStartTime: string | null,
  orbatEndTime: string | null,
  firstCountedCheckinAt: Date | null,
  lastCountedCheckoutAt: Date | null,
  orbatEventDate: Date | null
): {
  minutesLate: number;
  minutesGoneEarly: number;
  totalMinutesMissed: number;
} {
  if (!orbatStartTime || !orbatEndTime || !orbatEventDate) {
    return {
      minutesLate: 0,
      minutesGoneEarly: 0,
      totalMinutesMissed: 0,
    };
  }

  const [startHour, startMinute] = orbatStartTime.split(':').map(Number);
  const [endHour, endMinute] = orbatEndTime.split(':').map(Number);

  const startDate = new Date(orbatEventDate);
  startDate.setHours(startHour, startMinute, 0, 0);

  const endDate = new Date(orbatEventDate);
  endDate.setHours(endHour, endMinute, 0, 0);

  const firstHourEnd = new Date(startDate);
  firstHourEnd.setHours(firstHourEnd.getHours() + 1);

  const lastHourStart = new Date(endDate);
  lastHourStart.setHours(lastHourStart.getHours() - 1);

  let minutesLate = 0;
  let minutesGoneEarly = 0;

  // Calculate minutes late (if first check-in is after first hour ends)
  if (firstCountedCheckinAt && firstCountedCheckinAt > firstHourEnd) {
    const diffMs = firstCountedCheckinAt.getTime() - firstHourEnd.getTime();
    minutesLate = Math.ceil(diffMs / (1000 * 60));
    // Cap at 60 minutes (1 hour)
    minutesLate = Math.min(minutesLate, 60);
  }

  // Calculate minutes gone early (if last check-out is before last hour starts)
  if (lastCountedCheckoutAt && lastCountedCheckoutAt < lastHourStart) {
    const diffMs = lastHourStart.getTime() - lastCountedCheckoutAt.getTime();
    minutesGoneEarly = Math.ceil(diffMs / (1000 * 60));
    // Cap at 60 minutes (1 hour)
    minutesGoneEarly = Math.min(minutesGoneEarly, 60);
  }

  const totalMinutesMissed = minutesLate + minutesGoneEarly;

  return {
    minutesLate,
    minutesGoneEarly,
    totalMinutesMissed,
  };
}

/**
 * Calculate total minutes present from attendance sessions (within orbat window)
 */
export function calculateTotalMinutesPresent(
  countedSessions: Array<{ countedCheckinAt: Date; countedCheckoutAt: Date | null }>
): number {
  let totalMinutes = 0;

  for (const session of countedSessions) {
    if (session.countedCheckoutAt) {
      const diffMs =
        session.countedCheckoutAt.getTime() - session.countedCheckinAt.getTime();
      const minutes = Math.ceil(diffMs / (1000 * 60));
      totalMinutes += minutes;
    }
  }

  return totalMinutes;
}
