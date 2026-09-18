import { publicOrbatEvents } from '@/lib/api/realtime';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) { return publicOrbatEvents(request, (await context.params).id); }
