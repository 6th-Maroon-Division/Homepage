import { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/prisma';

const MAX_TRANSACTION_ATTEMPTS = 3;

export async function runSerializableTransaction<T>(
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 1; attempt <= MAX_TRANSACTION_ATTEMPTS; attempt += 1) {
    try {
      return await prisma.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      const retryable = error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034';
      if (!retryable || attempt === MAX_TRANSACTION_ATTEMPTS) throw error;
    }
  }

  throw new Error('Serializable transaction retry limit exceeded');
}
