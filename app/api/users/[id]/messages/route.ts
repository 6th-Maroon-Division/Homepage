import { userMessages } from '@/lib/api/messages';
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) { return userMessages(request, (await context.params).id, 'GET'); }
export async function PATCH(request: Request, context: Context) { return userMessages(request, (await context.params).id, 'PATCH'); }
