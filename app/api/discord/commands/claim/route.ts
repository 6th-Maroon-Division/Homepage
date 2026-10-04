import { claim } from '@/lib/api/discord/commands';
export async function POST(request: Request) { return claim(request); }
