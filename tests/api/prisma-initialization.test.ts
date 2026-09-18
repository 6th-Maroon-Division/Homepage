import { afterEach, beforeEach, expect, test, vi } from 'vitest';
const m = vi.hoisted(() => ({ client: vi.fn(function () { return { kind: 'client' }; }), adapter: vi.fn(function (options) { return { options }; }) }));
vi.mock('@/generated/prisma/client', () => ({ PrismaClient: m.client }));
vi.mock('@prisma/adapter-pg', () => ({ PrismaPg: m.adapter }));
const globalDb = globalThis as typeof globalThis & { prisma?: unknown };
beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); delete globalDb.prisma; vi.stubEnv('UI_TEST_MODE', '0'); vi.stubEnv('DATABASE_URL', 'postgresql://isolated/test'); vi.stubEnv('NODE_ENV', 'test'); });
afterEach(() => { delete globalDb.prisma; vi.unstubAllEnvs(); });
test('development caches the initialized Prisma instance and reuses it on module reload', async () => {
  const first = await import('@/lib/prisma');
  expect(globalDb.prisma).toBe(first.prisma);
  expect(m.adapter).toHaveBeenCalledWith({ connectionString: 'postgresql://isolated/test' });
  vi.resetModules();
  expect((await import('@/lib/prisma')).prisma).toBe(first.prisma);
  expect(m.client).toHaveBeenCalledTimes(1);
});
test('production does not retain a global Prisma instance', async () => {
  vi.stubEnv('NODE_ENV', 'production');
  expect((await import('@/lib/prisma')).prisma).toEqual({ kind: 'client' });
  expect(globalDb.prisma).toBeUndefined();
});
test.each([undefined, 'postgresql://different/test'])('UI tests reject missing or mismatched database URLs: %s', async url => {
  vi.stubEnv('UI_TEST_MODE', '1'); vi.stubEnv('UI_TEST_DATABASE_URL', url);
  await expect(import('@/lib/prisma')).rejects.toThrow('isolated Prisma-managed database');
  expect(m.client).not.toHaveBeenCalled();
});
test('UI isolated database uses single recycled connections', async () => {
  vi.stubEnv('UI_TEST_MODE', '1'); vi.stubEnv('UI_TEST_DATABASE_URL', 'postgresql://isolated/test');
  await import('@/lib/prisma');
  expect(m.adapter).toHaveBeenCalledWith({ connectionString: 'postgresql://isolated/test', max: 1, maxUses: 1 });
});
