import { evidence } from '@/lib/api/discord/evidence';
export async function GET(request: Request) { return evidence(request, 'GET'); }
export async function POST(request: Request) { return evidence(request, 'POST'); }
