import { bulkRoleSnapshot } from '@/lib/api/discord/bulk-roles';
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) { return bulkRoleSnapshot(request, (await context.params).id); }
