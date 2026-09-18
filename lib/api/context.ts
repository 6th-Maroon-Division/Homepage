import { AsyncLocalStorage } from 'node:async_hooks';
import type { ApiAuditContext } from './audit';

export const apiRequestContext = new AsyncLocalStorage<ApiAuditContext>();
