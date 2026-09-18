import { protectedEvents } from '@/lib/api/realtime';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) { return protectedEvents(request, 'training', (await context.params).id); }
