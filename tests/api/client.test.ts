import { afterEach, expect, test, vi } from 'vitest';
import { apiList, apiRequest } from '@/lib/api/client';
afterEach(() => vi.unstubAllGlobals());
test('API reader unwraps structured failures and preserves request options', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ data: { id: 1 }, meta: {} })).mockResolvedValueOnce(Response.json({ error: { message: 'Denied' } }, { status: 403 })).mockResolvedValueOnce(Response.json({}, { status: 500 }));
  vi.stubGlobal('fetch', fetcher);
  expect(await apiRequest('/api/example', { method: 'PATCH' })).toEqual({ data: { id: 1 }, meta: {} });
  expect(fetcher).toHaveBeenCalledWith('/api/example', { method: 'PATCH' });
  await expect(apiRequest('/api/example')).rejects.toThrow('Denied');
  await expect(apiRequest('/api/example')).rejects.toThrow('The request could not be completed.');
});
test('catalog reader follows every page and preserves filters and abort signal', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ data: [1], meta: { nextCursor: '1' } })).mockResolvedValueOnce(Response.json({ data: [2], meta: { nextCursor: null } }));
  vi.stubGlobal('fetch', fetcher);
  const signal = new AbortController().signal;
  expect(await apiList('/api/example?active=true', { signal })).toEqual([1, 2]);
  expect(fetcher).toHaveBeenLastCalledWith('/api/example?active=true&limit=100&cursor=1', { signal });
});
test('catalog reader stops on an absent cursor and rejects repeated cursors', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(Response.json({ data: [], meta: {} })));
  expect(await apiList('/api/example')).toEqual([]);
  vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(Response.json({ data: [], meta: { nextCursor: '1' } }))));
  await expect(apiList('/api/example')).rejects.toThrow('repeated pagination cursor');
});

test('non-JSON proxy failures and malformed successful responses show a useful message', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(new Response('<h1>Bad gateway</h1>', { status: 502 })).mockResolvedValueOnce(new Response(''));
  vi.stubGlobal('fetch', fetcher);
  await expect(apiRequest('/api/example')).rejects.toThrow('The request could not be completed.');
  await expect(apiRequest('/api/example')).rejects.toThrow('The request could not be completed.');
});
