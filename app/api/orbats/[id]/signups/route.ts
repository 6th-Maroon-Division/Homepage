import { signupRoute, signupId, listSignups } from '@/lib/api/signups';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) { return signupRoute(request, undefined, async (principal, audit) => listSignups(request, principal, audit, { orbatId: signupId((await context.params).id) })); }
