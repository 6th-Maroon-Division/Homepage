import { vi } from 'vitest';

// Use the real Prisma engine and PostgreSQL adapter, with one connection for
// PGlite's single-session PostgreSQL emulation. Retire each checkout so failed
// transactions cannot leave socket protocol state for the next request; an
// interactive transaction retains its connection until commit or rollback.
// No model or query is mocked.
vi.mock('@/lib/prisma', async () => {
  if (!process.env.API_INTEGRATION_DATABASE_URL || process.env.DATABASE_URL !== process.env.API_INTEGRATION_DATABASE_URL) {
    throw new Error('Integration tests require their isolated Prisma-managed database.');
  }
  const { PrismaClient } = await import('@/generated/prisma/client');
  const { PrismaPg } = await import('@prisma/adapter-pg');
  return { prisma: new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL, max: 1, maxUses: 1 }) }) };
});
