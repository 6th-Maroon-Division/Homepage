import { trainingRequestUserState } from '@/lib/api/training-request-user-state';
export async function PATCH(request: Request, context: { params: Promise<{ id: string; userId: string }> }) { return trainingRequestUserState(request, await context.params, 'read-state'); }
