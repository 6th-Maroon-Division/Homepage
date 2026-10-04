import { bulkRoles } from '@/lib/api/discord/bulk-roles';
export async function GET(request: Request) { return bulkRoles(request, 'GET'); }
export async function POST(request: Request) { return bulkRoles(request, 'POST'); }
