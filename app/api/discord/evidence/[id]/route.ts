import { evidenceAction } from '@/lib/api/discord/evidence';
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) { return evidenceAction(request, (await params).id); }
