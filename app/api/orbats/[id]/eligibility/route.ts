import { signupRoute, signupId, slotPage } from '@/lib/api/signups';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) { return signupRoute(request, undefined, async (principal, audit) => slotPage(request, signupId((await context.params).id), principal, audit)); }
