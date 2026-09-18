import { signupRoute, mutateSignup } from '@/lib/api/signups';
export async function POST(request: Request) { return signupRoute(request, undefined, (principal, audit) => mutateSignup(request, principal, audit, 'POST')); }
