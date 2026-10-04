import { caseUpdate, caseDetail } from '@/lib/api/discord/moderation';
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) { return caseUpdate(request, (await params).id); }

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) { return caseDetail(request, (await params).id); }
