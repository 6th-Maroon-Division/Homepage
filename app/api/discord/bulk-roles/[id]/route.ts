import { bulkRoleDetail } from '@/lib/api/discord/bulk-roles';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) { return bulkRoleDetail(request, (await context.params).id); }
