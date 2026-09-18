import { userPermissionAudit } from '@/lib/api/user-permissions';
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) { return userPermissionAudit(request, (await params).id); }
