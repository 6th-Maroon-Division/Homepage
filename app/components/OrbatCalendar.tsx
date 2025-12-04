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
    calendarDays.push(<div key={`empty-${i}`} className="h-24 bg-gray-800/30" />);
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
        className={`h-24 border border-gray-700 p-2 cursor-pointer hover:bg-gray-700/50 transition-colors ${
          isToday ? 'bg-blue-900/20 border-blue-600' : 'bg-gray-800/50'
        }`}
      >
        <div className={`text-sm font-semibold mb-1 ${isToday ? 'text-blue-400' : 'text-gray-400'}`}>
          {day}
        </div>
        <div className="space-y-1 overflow-hidden">
          {opsOnDay.slice(0, 2).map(op => (
            <div
              key={op.id}
              className="text-xs bg-blue-600/80 text-white px-1 py-0.5 rounded truncate"
              title={op.name}
            >
              {op.name}
            </div>
          ))}
          {opsOnDay.length > 2 && (
            <div className="text-xs text-gray-400">
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
      <div className="bg-gray-800/50 border border-gray-700 rounded-lg overflow-hidden">
        {/* Calendar Header */}
        <div className="px-6 py-4 border-b border-gray-700 flex items-center justify-between">
          <h2 className="text-xl font-semibold">
            {currentMonth.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}
          </h2>
          <div className="flex gap-2">
            <button
              onClick={handlePrevMonth}
              className="px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded-md transition-colors"
            >
              ←
            </button>
            <button
              onClick={() => setCurrentMonth(new Date())}
              className="px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded-md transition-colors text-sm"
            >
              Today
            </button>
            <button
              onClick={handleNextMonth}
              className="px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded-md transition-colors"
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
              <div key={day} className="text-center text-sm font-semibold text-gray-400 pb-2">
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
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowDayModal(false)}>
          <div className="bg-gray-800 border border-gray-700 rounded-lg p-6 max-w-md w-full mx-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-xl font-bold mb-4">
              {selectedDate.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            </h3>
            
            <div className="space-y-3 mb-4">
              <p className="text-sm text-gray-400">Operations on this day:</p>
              {selectedOrbats.map(orbat => (
                <button
                  key={orbat.id}
                  onClick={() => handleSelectOrbat(orbat.id)}
                  className="w-full text-left p-3 bg-gray-700/50 hover:bg-gray-700 rounded-md transition-colors"
                >
                  <div className="font-semibold">{orbat.name}</div>
                  {orbat.description && (
                    <div className="text-sm text-gray-400 mt-1 truncate">{orbat.description}</div>
                  )}
                </button>
              ))}
            </div>

            <div className="flex gap-3">
              <button
                onClick={handleCreateNew}
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md transition-colors font-medium"
              >
                Create New OrbAT
              </button>
              <button
                onClick={() => setShowDayModal(false)}
                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-md transition-colors"
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
