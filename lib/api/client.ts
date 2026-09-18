/** Shared browser-facing reader for the canonical API envelope. */
export async function apiRequest<T>(url: string, options?: RequestInit): Promise<{ data: T; meta: { nextCursor?: string | null; [key: string]: unknown } }> {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => null);
  if (!response.ok || body === null) throw new Error(body?.error?.message || 'The request could not be completed.');
  return body;
}

/** Catalog controls need every page; preserve caller filters and abort signals. */
export async function apiList<T>(url: string, options?: RequestInit): Promise<T[]> {
  const [path, query = ''] = url.split('?');
  const params = new URLSearchParams(query);
  params.set('limit', '100');
  const rows: T[] = [];
  const cursors = new Set<string>();
  let cursor: string | null = null;
  do {
    if (cursor) params.set('cursor', cursor);
    const page = await apiRequest<T[]>(`${path}?${params}`, options);
    rows.push(...page.data);
    cursor = page.meta.nextCursor ?? null;
    if (cursor && cursors.has(cursor)) throw new Error('The API returned a repeated pagination cursor.');
    if (cursor) cursors.add(cursor);
  } while (cursor);
  return rows;
}
