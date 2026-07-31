import { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/prisma';

type EventClient = Pick<typeof prisma, 'botEvent'> | Prisma.TransactionClient;

export async function appendBotEvent(
  input: {
    type: string;
    aggregate: 'rank' | 'orbat' | 'training';
    aggregateId?: string | number | null;
    payload: Prisma.InputJsonValue;
  },
  client: EventClient = prisma,
) {
  await client.botEvent.deleteMany({
    where: { occurredAt: { lt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } },
  });
  return client.botEvent.create({
    data: {
      type: input.type,
      aggregate: input.aggregate,
      aggregateId: input.aggregateId === null || input.aggregateId === undefined
        ? null
        : String(input.aggregateId),
      payload: input.payload,
    },
  });
}

export function serializeBotEvent(event: {
  id: bigint;
  type: string;
  occurredAt: Date;
  payload: unknown;
}) {
  return {
    id: event.id.toString(),
    type: event.type,
    occurredAt: event.occurredAt.toISOString(),
    payload: event.payload,
  };
}
