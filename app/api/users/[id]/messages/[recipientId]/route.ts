import { userMessages } from '@/lib/api/messages';
export async function PATCH(request: Request, context: { params: Promise<{ id: string; recipientId: string }> }) { const { id, recipientId } = await context.params; return userMessages(request, id, 'PATCH', recipientId); }
