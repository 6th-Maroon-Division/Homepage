import { trainingRequestUserState } from '@/lib/api/training-request-user-state';
type Context = { params: Promise<{ id: string; userId: string }> };
export async function GET(request: Request, context: Context) { return trainingRequestUserState(request, await context.params, 'read'); }
export async function PATCH(request: Request, context: Context) { return trainingRequestUserState(request, await context.params, 'subscription'); }
