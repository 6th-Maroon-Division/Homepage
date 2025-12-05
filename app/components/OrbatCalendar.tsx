'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Orbat = {
  id: number;
  name: string;
  description: string | null;
  eventDate: string | null;
};

type OrbatCalendarProps = {
  orbats: Orbat[];
};

export default function OrbatCalendar({ orbats }: OrbatCalendarProps) {
  const router = useRouter();
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [showDayModal, setShowDayModal] = useState(false);

  // Get first day of month and number of days
  const firstDayOfMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1);
  const lastDayOfMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0);
  const daysInMonth = lastDayOfMonth.getDate();
  const startingDayOfWeek = firstDayOfMonth.getDay(); // 0 = Sunday

  // Group orbats by date
  const orbatsByDate = new Map<string, Orbat[]>();
  orbats.forEach(orbat => {
    if (orbat.eventDate) {
      const dateKey = new Date(orbat.eventDate).toDateString();
      if (!orbatsByDate.has(dateKey)) {
        orbatsByDate.set(dateKey, []);
      }
      orbatsByDate.get(dateKey)!.push(orbat);
    }
  });

  const handlePrevMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1));
  };

  const handleNextMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1));
  };

  const handleDayClick = (day: number) => {
    const clickedDate = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), day);
    setSelectedDate(clickedDate);
    
    const opsOnDay = orbatsByDate.get(clickedDate.toDateString()) || [];
    
    if (opsOnDay.length === 0) {
      // No ops on this day, create new
      const isoDate = clickedDate.toISOString().split('T')[0];
      router.push(`/admin/orbats/new?date=${isoDate}`);
    } else {
      // Show modal with options
      setShowDayModal(true);
    }
  };

  const handleSelectOrbat = (orbatId: number) => {
    router.push(`/orbats/${orbatId}`);
    setShowDayModal(false);
  };

  const handleCreateNew = () => {
    if (selectedDate) {
      const isoDate = selectedDate.toISOString().split('T')[0];
      router.push(`/admin/orbats/new?date=${isoDate}`);
    }
    setShowDayModal(false);
  };

  // Generate calendar days
  const calendarDays = [];
  
  // Empty cells for days before month starts
  for (let i = 0; i < startingDayOfWeek; i++) {
    calendarDays.push(<div key={`empty-${i}`} className="h-24" style={{ backgroundColor: 'var(--muted)', opacity: 0.3 }} />);
  }
  
  // Days of the month
  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), day);
    const dateKey = date.toDateString();
    const opsOnDay = orbatsByDate.get(dateKey) || [];
    const isToday = date.toDateString() === new Date().toDateString();
    
    calendarDays.push(
      <div
        key={day}
        onClick={() => handleDayClick(day)}
        className="h-24 border p-2 cursor-pointer transition-colors"
        style={{
          borderColor: isToday ? 'var(--primary)' : 'var(--border)',
          backgroundColor: 'var(--background)',
        }}
      >
        <div className="text-sm font-semibold mb-1" style={{ color: isToday ? 'var(--primary)' : 'var(--foreground)' }}>
          {day}
        </div>
        <div className="space-y-1 overflow-hidden">
          {opsOnDay.slice(0, 2).map(op => (
            <div
              key={op.id}
              className="text-xs px-1 py-0.5 rounded truncate font-medium"
              style={{ backgroundColor: 'var(--primary)', color: 'var(--primary-foreground)' }}
              title={op.name}
            >
              {op.name}
            </div>
          ))}
          {opsOnDay.length > 2 && (
            <div className="text-xs font-medium" style={{ color: 'var(--muted-foreground)' }}>
              +{opsOnDay.length - 2} more
            </div>
          )}
        </div>
      </div>
    );
  }

  const selectedOrbats = selectedDate ? orbatsByDate.get(selectedDate.toDateString()) || [] : [];

  return (
    <>
      <div className="border rounded-lg overflow-hidden" style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)' }}>
        {/* Calendar Header */}
        <div className="px-6 py-4 flex items-center justify-between" style={{ borderBottomWidth: '1px', borderColor: 'var(--border)' }}>
          <h2 className="text-xl font-semibold" style={{ color: 'var(--foreground)' }}>
            {currentMonth.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}
          </h2>
          <div className="flex gap-2">
            <button
              onClick={handlePrevMonth}
              className="px-3 py-1 rounded-md transition-colors"
              style={{ backgroundColor: 'var(--muted)', color: 'var(--foreground)' }}
            >
              ←
            </button>
            <button
              onClick={() => setCurrentMonth(new Date())}
              className="px-3 py-1 rounded-md transition-colors text-sm"
              style={{ backgroundColor: 'var(--muted)', color: 'var(--foreground)' }}
            >
              Today
            </button>
            <button
              onClick={handleNextMonth}
              className="px-3 py-1 rounded-md transition-colors"
              style={{ backgroundColor: 'var(--muted)', color: 'var(--foreground)' }}
            >
              →
            </button>
          </div>
        </div>

        {/* Calendar Grid */}
        <div className="p-4">
          {/* Day headers */}
          <div className="grid grid-cols-7 gap-2 mb-2">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
              <div key={day} className="text-center text-sm font-semibold pb-2" style={{ color: 'var(--muted-foreground)' }}>
                {day}
              </div>
            ))}
          </div>
          
          {/* Calendar days */}
          <div className="grid grid-cols-7 gap-2">
            {calendarDays}
          </div>
        </div>
      </div>

      {/* Day Modal */}
      {showDayModal && selectedDate && (
        <div className="fixed inset-0 flex items-center justify-center z-50" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }} onClick={() => setShowDayModal(false)}>
          <div className="border rounded-lg p-6 max-w-md w-full mx-4" style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)' }} onClick={(e) => e.stopPropagation()}>
            <h3 className="text-xl font-bold mb-4" style={{ color: 'var(--foreground)' }}>
              {selectedDate.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            </h3>
            
            <div className="space-y-3 mb-4">
              <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>Operations on this day:</p>
              {selectedOrbats.map(orbat => (
                <button
                  key={orbat.id}
                  onClick={() => handleSelectOrbat(orbat.id)}
                  className="w-full text-left p-3 rounded-md transition-colors"
                  style={{ backgroundColor: 'var(--muted)', color: 'var(--foreground)' }}
                >
                  <div className="font-semibold">{orbat.name}</div>
                  {orbat.description && (
                    <div className="text-sm mt-1 truncate" style={{ color: 'var(--muted-foreground)' }}>{orbat.description}</div>
                  )}
                </button>
              ))}
            </div>

            <div className="flex gap-3">
              <button
                onClick={handleCreateNew}
                className="flex-1 px-4 py-2 rounded-md transition-colors font-medium"
                style={{ backgroundColor: 'var(--primary)', color: 'var(--primary-foreground)' }}
              >
                Create New OrbAT
              </button>
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
    </>
  );
}
