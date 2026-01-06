'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

type UiOp = {
  id: number;
  name: string;
  description: string | null;
  eventDate: string; // ISO string
  dateKey: string;   // YYYY-MM-DD
};

type CalendarWithOpsProps = {
  initialYear: number;
  initialMonth: number; // 0-based (0 = Jan)
  ops: UiOp[];
  isAdmin?: boolean;
  helpText?: string;
};

function getMonthCalendar(year: number, month: number) {
  const firstDay = new Date(year, month, 1);
  const firstWeekday = firstDay.getDay(); // 0 = Sunday
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const weeks: number[][] = [];
  let currentWeek: number[] = [];

  // pad start of first week
  for (let i = 0; i < firstWeekday; i++) {
    currentWeek.push(0);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    currentWeek.push(day);
    if (currentWeek.length === 7) {
      weeks.push(currentWeek);
      currentWeek = [];
    }
  }

  // pad end of last week
  if (currentWeek.length > 0) {
    while (currentWeek.length < 7) {
      currentWeek.push(0);
    }
    weeks.push(currentWeek);
  }

  return weeks;
}

function formatHumanDate(date: Date) {
  return date.toLocaleString('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

export default function CalendarWithOps({ initialYear, initialMonth, ops, isAdmin = false, helpText }: CalendarWithOpsProps) {
  const router = useRouter();

  const [currentYear, setCurrentYear] = useState(initialYear);
  const [currentMonth, setCurrentMonth] = useState(initialMonth); // 0-based
  const [selectedDateKey, setSelectedDateKey] = useState<string | null>(null);
  const [showDayModal, setShowDayModal] = useState(false);

  const weeks = useMemo(
    () => getMonthCalendar(currentYear, currentMonth),
    [currentYear, currentMonth],
  );

  const opsByDate = useMemo(() => {
    const map = new Map<string, UiOp[]>();
    for (const op of ops) {
      const list = map.get(op.dateKey) ?? [];
      list.push(op);
      map.set(op.dateKey, list);
    }
    return map;
  }, [ops]);

  const monthLabel = useMemo(
    () =>
      new Date(currentYear, currentMonth, 1).toLocaleString('en-GB', {
        month: 'long',
        year: 'numeric',
      }),
    [currentYear, currentMonth],
  );

  const selectedOps = selectedDateKey ? opsByDate.get(selectedDateKey) ?? [] : [];

  function handleDayClick(dateKey: string | null) {
    if (!dateKey) return;

    const dayOps = opsByDate.get(dateKey) ?? [];
    const clickedDate = new Date(dateKey);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    clickedDate.setHours(0, 0, 0, 0);
    const isPast = clickedDate < today;
    
    if (dayOps.length === 0) {
      // Empty day - create new if admin and not in the past
      if (isAdmin && !isPast) {
        router.push(`/admin/orbats/new?date=${dateKey}`);
      }
      return;
    }

    if (isAdmin) {
      // Admin always shows modal for days with operations
      setSelectedDateKey(dateKey);
      setShowDayModal(true);
    } else if (dayOps.length === 1) {
      // Public view: single op navigates directly
      router.push(`/orbats/${dayOps[0].id}`);
    } else {
      // Public view: multiple ops show modal
      setSelectedDateKey(dateKey);
      setShowDayModal(true);
    }
  }

  function goToPreviousMonth() {
    setSelectedDateKey(null);
    setCurrentMonth((prev) => {
      if (prev === 0) {
        setCurrentYear((y) => y - 1);
        return 11;
      }
      return prev - 1;
    });
  }

  function goToNextMonth() {
    setSelectedDateKey(null);
    setCurrentMonth((prev) => {
      if (prev === 11) {
        setCurrentYear((y) => y + 1);
        return 0;
      }
      return prev + 1;
    });
  }

  function goToCurrentMonth() {
    const now = new Date();
    setSelectedDateKey(null);
    setCurrentYear(now.getFullYear());
    setCurrentMonth(now.getMonth());
  }

  return (
    <div className={isAdmin ? '' : 'grid grid-cols-1 lg:grid-cols-[2fr,3fr] gap-6'}>
      {/* Calendar */}
      <section className="rounded-lg border p-4 space-y-4" style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)' }}>
        {/* Help Text */}
        {helpText && (
          <div className="p-3 rounded-md text-sm" style={{ backgroundColor: 'var(--muted)', color: 'var(--foreground)', border: '1px solid var(--border)' }}>
            {helpText}
          </div>
        )}
        {/* Month navigation */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={goToPreviousMonth}
              className="text-xs sm:text-sm px-2 py-1 rounded-md border"
              style={{ backgroundColor: 'var(--muted)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
            >
              ← Prev
            </button>
            <button
              type="button"
              onClick={goToNextMonth}
              className="text-xs sm:text-sm px-2 py-1 rounded-md border"
              style={{ backgroundColor: 'var(--muted)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
            >
              Next →
            </button>
          </div>
          <button
            type="button"
            onClick={goToCurrentMonth}
            className="text-[10px] sm:text-xs px-2 py-1 rounded-md border"
            style={{ backgroundColor: 'var(--muted)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
          >
            Today
          </button>
        </div>

        <h2 className="text-lg font-semibold text-center" style={{ color: 'var(--foreground)' }}>{monthLabel}</h2>

        <div className="grid grid-cols-7 text-center text-xs sm:text-sm mb-1" style={{ color: 'var(--muted-foreground)' }}>
          <div>Sun</div>
          <div>Mon</div>
          <div>Tue</div>
          <div>Wed</div>
          <div>Thu</div>
          <div>Fri</div>
          <div>Sat</div>
        </div>

        <div className="grid grid-cols-7 gap-1 text-xs sm:text-sm">
          {weeks.map((week, wi) =>
            week.map((day, di) => {
              if (day === 0) {
                return (
                  <div
                    key={`${wi}-${di}`}
                    className="h-10 sm:h-12 rounded-md border border-transparent"
                  />
                );
              }

              const date = new Date(currentYear, currentMonth, day);
              const yearStr = date.getFullYear();
              const monthStr = `${date.getMonth() + 1}`.padStart(2, '0');
              const dayStr = `${date.getDate()}`.padStart(2, '0');
              const dateKey = `${yearStr}-${monthStr}-${dayStr}`;
              const dayOps = opsByDate.get(dateKey) ?? [];
              const hasOps = dayOps.length > 0;
              const isSelected = selectedDateKey === dateKey;
              
              // Check if date is in the past
              const today = new Date();
              today.setHours(0, 0, 0, 0);
              const cellDate = new Date(date);
              cellDate.setHours(0, 0, 0, 0);
              const isPast = cellDate < today;
              
              // Clickable if has ops, or if admin and not past
              const isClickable = hasOps || (isAdmin && !isPast);

              return (
                <button
                  key={`${wi}-${di}`}
                  type="button"
                  onClick={() => handleDayClick(dateKey)}
                  disabled={!isClickable}
                  className="h-10 sm:h-12 rounded-md flex flex-col items-center justify-center border transition"
                  style={{
                    backgroundColor: hasOps 
                      ? 'var(--secondary)' 
                      : 'var(--background)',
                    borderColor: hasOps
                      ? 'var(--primary)'
                      : 'var(--border)',
                    borderWidth: hasOps ? '2px' : '1px',
                    color: 'var(--foreground)',
                    cursor: isClickable ? 'pointer' : 'default',
                    ...(isSelected && {
                      boxShadow: '0 0 0 2px var(--primary)',
                    }),
                  }}
                >
                  <span className="text-sm font-semibold">{day}</span>
                  {hasOps && (
                    <span className="mt-0.5 w-1.5 h-1.5 rounded-full" style={{ backgroundColor: 'var(--primary)' }} />
                  )}
                </button>
              );
            }),
          )}
        </div>

        <p className="text-xs mt-3" style={{ color: 'var(--muted-foreground)' }}>
          Click a day with a green dot to view its operations. If only one exists, you&apos;ll
          go straight to it. If multiple exist, you can pick one below.
          {isAdmin && ' As an admin, you can click any empty day to create a new operation.'}
        </p>

        {showDayModal && selectedDateKey && selectedOps.length > 0 && (
          <div className="fixed inset-0 flex items-center justify-center z-50" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }} onClick={() => setShowDayModal(false)}>
            <div className="border rounded-lg p-6 max-w-md w-full mx-4" style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)' }} onClick={(e) => e.stopPropagation()}>
              <h3 className="text-xl font-bold mb-4" style={{ color: 'var(--foreground)' }}>
                {new Date(selectedOps[0].eventDate).toLocaleDateString('en-GB', { 
                  weekday: 'long', 
                  day: 'numeric', 
                  month: 'long', 
                  year: 'numeric' 
                })}
              </h3>
              
              <div className="space-y-3 mb-4">
                <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>{selectedOps.length === 1 ? 'Operation on this day:' : 'Operations on this day:'}</p>
                {selectedOps.map((op) => (
                  <button
                    key={op.id}
                    onClick={() => {
                      const route = isAdmin ? `/admin/orbats/${op.id}` : `/orbats/${op.id}`;
                      router.push(route);
                      setShowDayModal(false);
                    }}
                    className="w-full text-left p-3 rounded-md transition-colors"
                    style={{ backgroundColor: 'var(--muted)', color: 'var(--foreground)' }}
                  >
                    <div className="font-semibold">{op.name}</div>
                    {op.description && (
                      <div className="text-sm mt-1 line-clamp-2" style={{ color: 'var(--muted-foreground)' }}>{op.description}</div>
                    )}
                  </button>
                ))}
              </div>

              <div className="flex gap-3">
                {isAdmin && (() => {
                  const clickedDate = new Date(selectedDateKey);
                  const today = new Date();
                  today.setHours(0, 0, 0, 0);
                  clickedDate.setHours(0, 0, 0, 0);
                  const isPast = clickedDate < today;
                  
                  return !isPast && (
                    <button
                      onClick={() => {
                        router.push(`/admin/orbats/new?date=${selectedDateKey}`);
                        setShowDayModal(false);
                      }}
                      className="flex-1 px-4 py-2 rounded-md transition-colors font-medium"
                      style={{ backgroundColor: 'var(--primary)', color: 'var(--primary-foreground)' }}
                    >
                      Create New OrbAT
                    </button>
                  );
                })()}
                <button
                  onClick={() => setShowDayModal(false)}
                  className="px-4 py-2 rounded-md transition-colors"
                  style={{ backgroundColor: 'var(--muted)', color: 'var(--foreground)' }}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {selectedDateKey && selectedOps.length > 1 && !showDayModal && (
          <div className="mt-4 pt-3 space-y-2" style={{ borderTopWidth: '1px', borderColor: 'var(--border)' }}>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold" style={{ color: 'var(--foreground)' }}>
                Operations on{' '}
                {formatHumanDate(new Date(selectedOps[0].eventDate))}
              </h3>
              <button
                type="button"
                className="text-xs hover:underline"
                style={{ color: 'var(--muted-foreground)' }}
                onClick={() => setSelectedDateKey(null)}
              >
                Clear
              </button>
            </div>

            <ul className="space-y-1">
              {selectedOps.map((op) => (
                <li key={op.id}>
                  <button
                    type="button"
                    className="w-full text-left text-xs sm:text-sm rounded-md px-2 py-1 border"
                    style={{ backgroundColor: 'var(--muted)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
                    onClick={() => router.push(`/orbats/${op.id}`)}
                  >
                    <span className="font-medium">{op.name}</span>
                    {op.description && (
                      <span className="ml-1" style={{ color: 'var(--muted-foreground)' }}>
                        – {op.description}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* List of all ops - only show for public view */}
      {!isAdmin && (
        <section className="rounded-lg border p-4 space-y-4" style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)' }}>
          <h2 className="text-lg font-semibold" style={{ color: 'var(--foreground)' }}>All operations</h2>

          {ops.length === 0 && (
            <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>No operations yet.</p>
          )}

          <ul className="space-y-3">
            {ops.map((op) => (
              <li
                key={op.id}
                className="rounded-md border px-3 py-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2"
                style={{ backgroundColor: 'var(--muted)', borderColor: 'var(--border)' }}
              >
                <div>
                  <button
                    type="button"
                    onClick={() => router.push(`/orbats/${op.id}`)}
                    className="text-sm sm:text-base font-medium hover:underline"
                    style={{ color: 'var(--foreground)' }}
                  >
                    {op.name}
                  </button>
                  {op.description && (
                    <p className="text-xs line-clamp-2" style={{ color: 'var(--muted-foreground)' }}>
                      {op.description}
                    </p>
                  )}
                </div>
                <div className="text-right text-xs" style={{ color: 'var(--foreground)' }}>
                  {formatHumanDate(new Date(op.eventDate))}
                  <div className="text-[10px]" style={{ color: 'var(--muted-foreground)', opacity: 0.7 }}>
                    {op.dateKey}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
