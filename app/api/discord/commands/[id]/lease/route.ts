import { renewLease } from '@/lib/api/discord/commands';
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) { return renewLease(request, (await params).id); }
