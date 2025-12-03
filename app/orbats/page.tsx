// app/orbats/page.tsx
import { prisma } from '@/lib/prisma';
import CalendarWithOps from './CalendarWithOps';

type OrbatWithDates = {
  id: number;
  name: string;
  description: string | null;
  eventDate: Date | null;
  createdAt: Date;
};

export default async function OrbatsPage() {
  const orbats = (await prisma.orbat.findMany({
    orderBy: [
      { eventDate: 'asc' },
      { createdAt: 'asc' },
    ],
  })) as OrbatWithDates[];

  const uiOps = orbats.map((orbat) => {
    const date = orbat.eventDate ?? orbat.createdAt;
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, '0');
    const day = `${date.getDate()}`.padStart(2, '0');
    const dateKey = `${year}-${month}-${day}`;

    return {
      id: orbat.id,
      name: orbat.name,
      description: orbat.description,
      eventDate: date.toISOString(),
      dateKey,
    };
  });

  const now = new Date();
  const initialYear = now.getFullYear();
  const initialMonth = now.getMonth(); // 0-based

  return (
    <main className="min-h-screen">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        <header className="space-y-2">
          <h1 className="text-2xl sm:text-3xl font-bold">Operations</h1>
          <p className="text-sm sm:text-base text-gray-300">
            Click days in the calendar to jump to operations. Use Prev/Next to
            change months. If multiple ops exist on a day, you&apos;ll see a
            list to choose from.
          </p>
        </header>

        <CalendarWithOps initialYear={initialYear} initialMonth={initialMonth} ops={uiOps} />
      </div>
    </main>
  );
}
