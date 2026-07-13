type OrbatScheduleLike = {
  startsAtUtc?: Date | null;
  endsAtUtc?: Date | null;
  eventDate?: Date | null;
  startTime?: string | null;
  endTime?: string | null;
};

const TIME_PATTERN = /^\d{2}:\d{2}$/;

export function resolveOrbatScheduleWindow(schedule: OrbatScheduleLike): {
  startsAtUtc: Date | null;
  endsAtUtc: Date | null;
  cutoff: Date | null;
} {
  let startsAtUtc = schedule.startsAtUtc ? new Date(schedule.startsAtUtc) : null;
  let endsAtUtc = schedule.endsAtUtc ? new Date(schedule.endsAtUtc) : null;

  const eventDate = schedule.eventDate ? new Date(schedule.eventDate) : null;

  if (!startsAtUtc && eventDate && schedule.startTime && TIME_PATTERN.test(schedule.startTime)) {
    const [hours, minutes] = schedule.startTime.split(':').map(Number);
    startsAtUtc = new Date(eventDate);
    startsAtUtc.setUTCHours(hours, minutes, 0, 0);
  }

  if (!endsAtUtc && eventDate && schedule.endTime && TIME_PATTERN.test(schedule.endTime)) {
    const [hours, minutes] = schedule.endTime.split(':').map(Number);
    endsAtUtc = new Date(eventDate);
    endsAtUtc.setUTCHours(hours, minutes, 0, 0);
  }

  if (startsAtUtc && endsAtUtc && endsAtUtc <= startsAtUtc) {
    endsAtUtc = new Date(endsAtUtc.getTime() + 24 * 60 * 60 * 1000);
  }

  if (endsAtUtc) {
    return {
      startsAtUtc,
      endsAtUtc,
      cutoff: endsAtUtc,
    };
  }

  if (startsAtUtc) {
    return {
      startsAtUtc,
      endsAtUtc: null,
      cutoff: startsAtUtc,
    };
  }

  if (!eventDate) {
    return {
      startsAtUtc: null,
      endsAtUtc: null,
      cutoff: null,
    };
  }

  const cutoff = new Date(eventDate);
  cutoff.setUTCHours(23, 59, 59, 999);

  return {
    startsAtUtc: null,
    endsAtUtc: null,
    cutoff,
  };
}
