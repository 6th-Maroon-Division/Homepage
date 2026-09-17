import { randomUUID } from 'node:crypto';
import type { PermissionKey } from '@/lib/permissions';
import type { ApiPrincipal } from './principal';
import { prisma } from '@/lib/prisma';
import { authenticateApi, requireApiAccess } from './auth';
import { apiError } from './response';
import { writeApiAudit, type ApiAuditContext } from './audit';
import { apiRequestContext } from './context';
import { InvalidJsonBody } from './request';

async function withApiContext(request: Request, handler: (context: ApiAuditContext) => Promise<Response>) {
  const context: ApiAuditContext = { principal: null, correlationId: randomUUID(), method: request.method, path: new URL(request.url).pathname };
  return apiRequestContext.run(context, async () => {
    let response: Response;
    try {
      response = await handler(context);
      if (response.status === 401 || response.status === 403) await writeApiAudit(prisma, context, { action: 'access.denied', resource: 'api', outcome: 'denied' });
    } catch (error) {
      if (error instanceof InvalidJsonBody) response = apiError(400, 'invalid_request', error.message);
      else {
        response = apiError(500, 'internal_error', 'The request could not be completed.');
        console.error('API request failed', { timestamp: new Date().toISOString(), path: context.path, correlationId: context.correlationId });
      }
    }
    response.headers.set('X-Request-Id', context.correlationId);
    return response;
  });
}
export async function handleApiRequest(request: Request, permission: PermissionKey | undefined, handler: (principal: ApiPrincipal, context: ApiAuditContext) => Promise<Response>) {
  return withApiContext(request, async context => {
    const access = await requireApiAccess(request, permission);
    context.principal = access.principal;
    return access.error ? access.error : handler(access.principal, context);
  });
}
export async function handlePublicApiRequest(request: Request, handler: (principal: ApiPrincipal | null, context: ApiAuditContext) => Promise<Response>) {
  return withApiContext(request, async context => {
    const principal = await authenticateApi(request);
    context.principal = principal;
    if (!principal && request.headers.has('authorization')) return apiError(401, 'unauthorized', 'Valid bot token required when Authorization is provided.');
    return handler(principal, context);
  });
}
