import { apiError } from './response';

type CategoryPatch = { name?: string; orderIndex?: number; swapWithCategoryId?: number };
export function parseTrainingCategoryBody(body: unknown, creating: boolean): { data: CategoryPatch; error?: never } | { error: Response; data?: never } {
  const invalid = (message: string) => ({ error: apiError(422, 'validation_failed', message) });
  if (!body || typeof body !== 'object' || Array.isArray(body)) return invalid('Request body must be an object.');
  const input = body as Record<string, unknown>;
  const keys = Object.keys(input);
  const allowed = creating ? ['name'] : ['name', 'orderIndex', 'swapWithCategoryId'];
  if (keys.some(key => !allowed.includes(key))) return invalid('Unknown category fields.');
  if (!keys.length) return invalid('At least one category field is required.');
  if ((creating || 'name' in input) && (typeof input.name !== 'string' || !input.name.trim())) return invalid('name must be a non-empty string.');
  if ('orderIndex' in input && (typeof input.orderIndex !== 'number' || !Number.isInteger(input.orderIndex) || input.orderIndex < 0 || input.orderIndex > 2147483647)) return invalid('orderIndex must be a nonnegative 32-bit integer.');
  if ('swapWithCategoryId' in input && (keys.length !== 1 || typeof input.swapWithCategoryId !== 'number' || !Number.isInteger(input.swapWithCategoryId) || input.swapWithCategoryId < 1 || input.swapWithCategoryId > 2147483647)) return invalid('swapWithCategoryId must be a positive numeric database id and supplied alone.');
  return { data: {
    ...(typeof input.name === 'string' ? { name: input.name.trim() } : {}),
    ...(typeof input.orderIndex === 'number' ? { orderIndex: input.orderIndex } : {}),
    ...(typeof input.swapWithCategoryId === 'number' ? { swapWithCategoryId: input.swapWithCategoryId } : {}),
  } };
}

export function categoryMutationError(error: unknown): Response {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
  if (code === 'P2002') return apiError(409, 'conflict', 'Category already exists.');
  if (code === 'P2025') return apiError(404, 'not_found', 'Category not found.');
  throw error;
}
