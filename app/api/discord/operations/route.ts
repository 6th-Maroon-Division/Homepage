import { operations } from '@/lib/api/discord/operations';
export async function GET(request: Request) { return operations(request, 'GET'); }
export async function POST(request: Request) { return operations(request, 'POST'); }
