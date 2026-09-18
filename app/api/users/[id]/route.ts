import { userProfile } from '@/lib/api/user-profile';
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) { return userProfile(request, (await context.params).id, 'GET'); }
export async function PATCH(request: Request, context: Context) { return userProfile(request, (await context.params).id, 'PATCH'); }
export async function DELETE(request: Request, context: Context) { return userProfile(request, (await context.params).id, 'DELETE'); }
