import { cases } from '@/lib/api/discord/moderation';
export async function GET(request: Request) { return cases(request, 'GET'); }
export async function POST(request: Request) { return cases(request, 'POST'); }
