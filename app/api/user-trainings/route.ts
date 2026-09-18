import { credentialRoute, listCredentials, mutateCredentials } from '@/lib/api/user-trainings';
export function GET(request: Request) { return credentialRoute(request, (principal, audit) => listCredentials(request, principal, audit)); }
export function POST(request: Request) { return credentialRoute(request, (principal, audit) => mutateCredentials(request, principal, audit, 'create')); }
export function PATCH(request: Request) { return credentialRoute(request, (principal, audit) => mutateCredentials(request, principal, audit, 'bulk')); }
