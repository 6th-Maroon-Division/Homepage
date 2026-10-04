import { commands } from '@/lib/api/discord/commands';
export async function GET(request: Request) { return commands(request, 'GET'); }
export async function POST(request: Request) { return commands(request, 'POST'); }
