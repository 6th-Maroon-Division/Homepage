import { heartbeat } from '@/lib/api/discord/configuration';
export async function POST(request: Request) { return heartbeat(request); }
