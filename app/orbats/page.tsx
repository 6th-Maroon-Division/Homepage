import CalendarWithOps from './components/CalendarWithOps';
import { getApiSessionPrincipal } from '@/lib/api/auth';
import { getCalendarItems } from '@/lib/api/calendar';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function OrbatsPage() {
  const principal = await getApiSessionPrincipal();
  const items = await getCalendarItems(principal);
  items.sort((a, b) => Date.parse(a.eventDate) - Date.parse(b.eventDate));
  const now = new Date();

  return (
    <main className="min-h-screen">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        <CalendarWithOps
          initialYear={now.getFullYear()}
          initialMonth={now.getMonth()}
          ops={items}
          helpText="Operations and your scheduled training sessions share this calendar. Side ops use teal; training sessions use the secondary colour."
        />
      </div>
    </main>
  );
}
