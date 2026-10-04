import { configuration } from '@/lib/api/discord/configuration';
export async function GET(request: Request) { return configuration(request, 'GET'); }
export async function PUT(request: Request) { return configuration(request, 'PUT'); }
