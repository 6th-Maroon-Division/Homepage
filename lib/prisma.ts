// lib/prisma.ts
import 'dotenv/config';
import { PrismaClient } from '../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

const uiTestDatabase = process.env.UI_TEST_MODE === '1';
if (uiTestDatabase && (!process.env.UI_TEST_DATABASE_URL || process.env.DATABASE_URL !== process.env.UI_TEST_DATABASE_URL)) {
  throw new Error('UI tests require their isolated Prisma-managed database.');
}

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL!,
  // PGlite emulates a single PostgreSQL session. Recycle connections after
  // checkout so a rolled-back request cannot affect the next browser action.
  ...(uiTestDatabase ? { max: 1, maxUses: 1 } : {}),
});

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter,
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
