import { complete } from '@/lib/api/discord/commands';
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) { return complete(request, (await params).id); }
