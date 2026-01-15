'use client';

import { useState, useEffect } from 'react';
import LoadingSpinner from '@/app/components/ui/LoadingSpinner';

interface UserAttendanceStats {
  totalEvents: number;
  presentCount: number;
  lateCount: number;
  goneEarlyCount: number;
  partialCount: number;
  absentCount: number;
  noShowCount: number;
  attendancePercentage: number;
  avgMinutesMissed: number;
}

interface AttendanceRecord {
  id: number;
  status: string;
  checkedInAt: string | null;
  checkedOutAt: string | null;
  minutesLate: number;
  minutesGoneEarly: number;
  totalMinutesMissed: number;
  createdAt: string;
  signup: {
    subslot: {
      slot: {
        orbat: {
          name: string;
          eventDate: string;
        };
      };
    };
  };
}

export default function UserAttendanceProfile({ userId }: { userId: number }) {
  const [stats, setStats] = useState<UserAttendanceStats | null>(null);
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [durationDays, setDurationDays] = useState(30);
  // const { showToast } = { showToast: (msg: string) => console.log(msg) };

  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      try {
        // Fetch stats
        const statsResponse = await fetch(
          `/api/users/${userId}/attendance/stats?days=${durationDays}`
        );
        if (statsResponse.ok) {
          const statsData = await statsResponse.json();
          setStats(statsData);
        }

        // Fetch records
        const recordsResponse = await fetch(
          `/api/users/${userId}/attendance?days=${durationDays}`
        );
        if (recordsResponse.ok) {
          const recordsData = await recordsResponse.json();
          setRecords(recordsData);
        }
      } catch (error) {
        console.error('Error fetching attendance data:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [userId, durationDays]);

  if (isLoading) {
    return (
      <div className="flex justify-center py-8">
        <LoadingSpinner />
      </div>
    );
  }

  if (!stats) {
    return <p className="text-center text-gray-500">Unable to load attendance data</p>;
  }

  const statusColors: Record<string, string> = {
    present: 'bg-green-100 text-green-800',
    absent: 'bg-red-100 text-red-800',
    late: 'bg-yellow-100 text-yellow-800',
    gone_early: 'bg-yellow-100 text-yellow-800',
    partial: 'bg-orange-100 text-orange-800',
    no_show: 'bg-red-100 text-red-800',
  };

  return (
    <div className="space-y-6">
      {/* Duration Selector */}
      <div className="flex gap-2">
        {[30, 90, 180, 365].map((days) => (
          <button
            key={days}
            onClick={() => setDurationDays(days)}
            className={`px-4 py-2 rounded font-medium transition-colors ${
              durationDays === days
                ? 'bg-blue-600 text-white'
                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
            }`}
          >
            {days === 365 ? 'All time' : `${days} days`}
          </button>
        ))}
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-gradient-to-br from-blue-50 to-blue-100 p-4 rounded-lg">
          <p className="text-sm text-gray-600">Attendance %</p>
          <p className="text-3xl font-bold text-blue-600">{stats.attendancePercentage}%</p>
        </div>

        <div className="bg-gradient-to-br from-green-50 to-green-100 p-4 rounded-lg">
          <p className="text-sm text-gray-600">Present</p>
          <p className="text-3xl font-bold text-green-600">{stats.presentCount}</p>
        </div>

        <div className="bg-gradient-to-br from-yellow-50 to-yellow-100 p-4 rounded-lg">
          <p className="text-sm text-gray-600">Late/Early</p>
          <p className="text-3xl font-bold text-yellow-600">
            {stats.lateCount + stats.goneEarlyCount}
          </p>
        </div>

        <div className="bg-gradient-to-br from-red-50 to-red-100 p-4 rounded-lg">
          <p className="text-sm text-gray-600">Absent</p>
          <p className="text-3xl font-bold text-red-600">
            {stats.absentCount + stats.noShowCount}
          </p>
        </div>

        <div className="bg-gradient-to-br from-orange-50 to-orange-100 p-4 rounded-lg">
          <p className="text-sm text-gray-600">Partial</p>
          <p className="text-3xl font-bold text-orange-600">{stats.partialCount}</p>
        </div>

        <div className="bg-gradient-to-br from-purple-50 to-purple-100 p-4 rounded-lg">
          <p className="text-sm text-gray-600">Total Events</p>
          <p className="text-3xl font-bold text-purple-600">{stats.totalEvents}</p>
        </div>

        <div className="bg-gradient-to-br from-indigo-50 to-indigo-100 p-4 rounded-lg col-span-2">
          <p className="text-sm text-gray-600">Avg Minutes Missed</p>
          <p className="text-3xl font-bold text-indigo-600">{stats.avgMinutesMissed}</p>
        </div>
      </div>

      {/* Attendance History */}
      <div>
        <h3 className="text-lg font-semibold mb-4">Attendance History</h3>
        {records.length === 0 ? (
          <p className="text-center text-gray-500 py-8">No attendance records found</p>
        ) : (
          <div className="overflow-x-auto border rounded">
            <table className="w-full">
              <thead className="bg-gray-100">
                <tr>
                  <th className="px-4 py-2 text-left">Event</th>
                  <th className="px-4 py-2 text-left">Date</th>
                  <th className="px-4 py-2 text-left">Status</th>
                  <th className="px-4 py-2 text-center">Minutes Late</th>
                  <th className="px-4 py-2 text-center">Minutes Gone Early</th>
                </tr>
              </thead>
              <tbody>
                {records.map((record) => (
                  <tr key={record.id} className="border-t hover:bg-gray-50">
                    <td className="px-4 py-2">
                      {record.signup.subslot.slot.orbat.name}
                    </td>
                    <td className="px-4 py-2">
                      {new Date(
                        record.signup.subslot.slot.orbat.eventDate
                      ).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-2">
                      <span
                        className={`inline-block px-3 py-1 rounded text-sm font-medium ${
                          statusColors[record.status]
                        }`}
                      >
                        {record.status}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-center">{record.minutesLate}</td>
                    <td className="px-4 py-2 text-center">{record.minutesGoneEarly}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
