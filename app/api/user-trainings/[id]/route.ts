import { credentialId, credentialRoute, mutateCredentials } from '@/lib/api/user-trainings';
type Context = { params: Promise<{ id: string }> };
export function PATCH(request: Request, context: Context) { return credentialRoute(request, async (principal, audit) => mutateCredentials(request, principal, audit, 'update', credentialId((await context.params).id))); }
export function DELETE(request: Request, context: Context) { return credentialRoute(request, async (principal, audit) => mutateCredentials(request, principal, audit, 'delete', credentialId((await context.params).id))); }
