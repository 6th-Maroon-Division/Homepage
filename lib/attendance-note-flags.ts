export type AttendanceNoteFlags = {
  notedAbsent: boolean;
  notedLateEarly: boolean;
  notedUnsure: boolean;
};

type AttendanceNoteLike = {
  status: 'absent' | 'unsure' | 'late_unsure';
  lateMinutes: number | null;
  leaveEarlyMinutes: number | null;
};

export function buildAttendanceNoteFlags(note: AttendanceNoteLike | null): AttendanceNoteFlags {
  if (!note) {
    return {
      notedAbsent: false,
      notedLateEarly: false,
      notedUnsure: false,
    };
  }

  return {
    notedAbsent: note.status === 'absent',
    notedLateEarly:
      note.status === 'late_unsure' ||
      (note.lateMinutes ?? 0) > 0 ||
      (note.leaveEarlyMinutes ?? 0) > 0,
    notedUnsure: note.status === 'unsure' || note.status === 'late_unsure',
  };
}
