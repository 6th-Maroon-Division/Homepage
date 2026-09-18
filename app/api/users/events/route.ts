import { protectedEvents } from '@/lib/api/realtime';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) { return protectedEvents(request, 'users'); }
