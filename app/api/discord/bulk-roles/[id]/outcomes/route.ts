import { bulkRoleTargets } from '@/lib/api/discord/bulk-roles';
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) { return bulkRoleTargets(request, (await context.params).id, true); }
