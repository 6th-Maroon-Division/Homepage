import { signupRoute, listSignups } from '@/lib/api/signups';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) { return signupRoute(request, undefined, async (principal, audit) => listSignups(request, principal, audit, { userId: (await context.params).id })); }
