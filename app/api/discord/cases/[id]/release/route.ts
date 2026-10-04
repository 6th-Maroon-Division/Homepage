import { release } from '@/lib/api/discord/moderation';
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) { return release(request, (await params).id); }
