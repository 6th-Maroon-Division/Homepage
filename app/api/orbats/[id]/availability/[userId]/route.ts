import { signupRoute, signupId, availability } from '@/lib/api/signups';
type Context = { params: Promise<{ id: string; userId: string }> };
export async function GET(request: Request, context: Context) { return signupRoute(request, undefined, async (principal, audit) => { const params = await context.params; return availability(request, principal, audit, signupId(params.id), params.userId, 'GET'); }); }
export async function PATCH(request: Request, context: Context) { return signupRoute(request, undefined, async (principal, audit) => { const params = await context.params; return availability(request, principal, audit, signupId(params.id), params.userId, 'PATCH'); }); }
export async function DELETE(request: Request, context: Context) { return signupRoute(request, undefined, async (principal, audit) => { const params = await context.params; return availability(request, principal, audit, signupId(params.id), params.userId, 'DELETE'); }); }
