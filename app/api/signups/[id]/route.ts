import { signupRoute, signupId, mutateSignup } from '@/lib/api/signups';
type Context = { params: Promise<{ id: string }> };
export async function PATCH(request: Request, context: Context) { return signupRoute(request, undefined, async (principal, audit) => mutateSignup(request, principal, audit, 'PATCH', signupId((await context.params).id))); }
export async function DELETE(request: Request, context: Context) { return signupRoute(request, undefined, async (principal, audit) => mutateSignup(request, principal, audit, 'DELETE', signupId((await context.params).id))); }
