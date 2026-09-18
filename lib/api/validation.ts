/** Database IDs are positive, safely represented decimal integers. */
export function parsePositiveId(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

type PaginationResult =
  | { data: { limit: number; cursor: number | null }; error?: never }
  | { data?: never; error: string };

/** Missing values use defaults; malformed values never reach database queries. */
export function parseCursorPagination(
  params: URLSearchParams,
  options: { defaultLimit: number; maxLimit: number },
): PaginationResult {
  const limit = params.has('limit') ? parsePositiveId(params.get('limit')) : options.defaultLimit;
  if (limit === null) return { error: 'limit must be a positive integer.' };
  const cursor = params.has('cursor') ? parsePositiveId(params.get('cursor')) : null;
  if (params.has('cursor') && (cursor === null || cursor > 2147483647)) return { error: 'cursor must be a positive 32-bit integer id.' };
  return { data: { limit: Math.min(limit, options.maxLimit), cursor } };
}

/** Each query key must be declared once; body-only operations pass an empty list. */
export function validateQueryParameters(request: Request, allowed: readonly string[]): string | null {
  const params = new URL(request.url).searchParams;
  for (const key of params.keys()) {
    if (!allowed.includes(key)) return `Unknown query parameter: ${key}.`;
    if (params.getAll(key).length !== 1) return `Query parameter ${key} must occur once.`;
  }
  return null;
}
