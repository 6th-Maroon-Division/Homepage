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
  return date.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

export default function CalendarWithOps({ initialYear, initialMonth, ops }: CalendarWithOpsProps) {
  const router = useRouter();

  const [currentYear, setCurrentYear] = useState(initialYear);
  const [currentMonth, setCurrentMonth] = useState(initialMonth); // 0-based
  const [selectedDateKey, setSelectedDateKey] = useState<string | null>(null);

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
      new Date(currentYear, currentMonth, 1).toLocaleString(undefined, {
        month: 'long',
        year: 'numeric',
      }),
    [currentYear, currentMonth],
  );

  const selectedOps = selectedDateKey ? opsByDate.get(selectedDateKey) ?? [] : [];

  function handleDayClick(dateKey: string | null) {
    if (!dateKey) return;

    const dayOps = opsByDate.get(dateKey) ?? [];
    if (dayOps.length === 0) return;

    if (dayOps.length === 1) {
      router.push(`/orbats/${dayOps[0].id}`);
    } else {
      setSelectedDateKey(dateKey);
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
    <div className="grid grid-cols-1 lg:grid-cols-[2fr,3fr] gap-6">
      {/* Calendar */}
      <section className="rounded-lg border border-slate-700 bg-slate-900/60 p-4 space-y-4">
        {/* Month navigation */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={goToPreviousMonth}
              className="text-xs sm:text-sm px-2 py-1 rounded-md border border-slate-600 bg-slate-900 hover:bg-slate-800"
            >
              ← Prev
            </button>
            <button
              type="button"
              onClick={goToNextMonth}
              className="text-xs sm:text-sm px-2 py-1 rounded-md border border-slate-600 bg-slate-900 hover:bg-slate-800"
            >
              Next →
            </button>
          </div>
          <button
            type="button"
            onClick={goToCurrentMonth}
            className="text-[10px] sm:text-xs px-2 py-1 rounded-md border border-slate-600 bg-slate-900 hover:bg-slate-800"
          >
            Today
          </button>
        </div>

        <h2 className="text-lg font-semibold text-center">{monthLabel}</h2>

        <div className="grid grid-cols-7 text-center text-xs sm:text-sm text-gray-400 mb-1">
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

              return (
                <button
                  key={`${wi}-${di}`}
                  type="button"
                  onClick={() => handleDayClick(dateKey)}
                  className={[
                    'h-10 sm:h-12 rounded-md flex flex-col items-center justify-center border transition',
                    hasOps
                      ? 'border-emerald-500 bg-emerald-500/10 hover:bg-emerald-500/20'
                      : 'border-slate-700 bg-slate-900 hover:bg-slate-800',
                    isSelected ? 'ring-2 ring-emerald-400' : '',
                  ].join(' ')}
                >
                  <span className="text-sm">{day}</span>
                  {hasOps && (
                    <span className="mt-0.5 w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  )}
                </button>
              );
            }),
          )}
        </div>

        <p className="text-xs text-gray-400 mt-3">
          Click a day with a green dot to view its operations. If only one exists, you&apos;ll
          go straight to it. If multiple exist, you can pick one below.
        </p>

        {selectedDateKey && selectedOps.length > 1 && (
          <div className="mt-4 border-t border-slate-700 pt-3 space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">
                Operations on{' '}
                {formatHumanDate(new Date(selectedOps[0].eventDate))}
              </h3>
              <button
                type="button"
                className="text-xs text-gray-400 hover:text-gray-200"
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
                    className="w-full text-left text-xs sm:text-sm rounded-md px-2 py-1 border border-slate-700 bg-slate-900/80 hover:bg-slate-800"
                    onClick={() => router.push(`/orbats/${op.id}`)}
                  >
                    <span className="font-medium">{op.name}</span>
                    {op.description && (
                      <span className="ml-1 text-gray-400">
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

      {/* List of all ops */}
      <section className="rounded-lg border border-slate-700 bg-slate-900/60 p-4 space-y-4">
        <h2 className="text-lg font-semibold">All operations</h2>

        {ops.length === 0 && (
          <p className="text-sm text-gray-400">No operations yet.</p>
        )}

        <ul className="space-y-3">
          {ops.map((op) => (
            <li
              key={op.id}
              className="rounded-md border border-slate-700 bg-slate-900/80 px-3 py-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2"
            >
              <div>
                <button
                  type="button"
                  onClick={() => router.push(`/orbats/${op.id}`)}
                  className="text-sm sm:text-base font-medium hover:underline"
                >
                  {op.name}
                </button>
                {op.description && (
                  <p className="text-xs text-gray-400 line-clamp-2">
                    {op.description}
                  </p>
                )}
              </div>
              <div className="text-right text-xs text-gray-300">
                {formatHumanDate(new Date(op.eventDate))}
                <div className="text-[10px] text-gray-500">
                  {op.dateKey}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
