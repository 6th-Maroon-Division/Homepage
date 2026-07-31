import { NextRequest } from 'next/server';
import { authenticateDatabaseBot, botError } from '@/lib/bot-api';
import { botEventFeed } from '@/lib/bot-event-feed';

export async function GET(request: NextRequest) {
  if (!(await authenticateDatabaseBot(request))) return botError(401, 'unauthorized', 'Invalid or revoked bot token.');
  return botEventFeed(request, 'rank');
}
