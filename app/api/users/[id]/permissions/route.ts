import { userPermissions } from '@/lib/api/user-permissions';
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) { return userPermissions(request, (await params).id, 'GET'); }
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) { return userPermissions(request, (await params).id, 'PATCH'); }
