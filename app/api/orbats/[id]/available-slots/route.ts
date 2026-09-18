import { availableSlots } from '@/lib/api/signups';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) { return availableSlots(request, (await context.params).id); }
