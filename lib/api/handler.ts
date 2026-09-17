import { randomUUID } from 'node:crypto';
import type { PermissionKey } from '@/lib/permissions';
import type { ApiPrincipal } from './principal';
import { prisma } from '@/lib/prisma';
import { requireApiAccess } from './auth';
import { apiError } from './response';
import { writeApiAudit, type ApiAuditContext } from './audit';
import { apiRequestContext } from './context';
import { InvalidJsonBody } from './request';

export async function handleApiRequest(request: Request, permission: PermissionKey | undefined, handler: (principal: ApiPrincipal, context: ApiAuditContext) => Promise<Response>) {
  const context: ApiAuditContext = { principal: null, correlationId: randomUUID(), method: request.method, path: new URL(request.url).pathname };
  return apiRequestContext.run(context, async () => {
    let response: Response;
    try {
      const access = await requireApiAccess(request, permission);
      context.principal = access.principal;
      response = access.error ? access.error : await handler(access.principal, context);
      if (response.status === 401 || response.status === 403) {
        await writeApiAudit(prisma, context, { action: 'access.denied', resource: 'api', outcome: 'denied' });
      }
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
