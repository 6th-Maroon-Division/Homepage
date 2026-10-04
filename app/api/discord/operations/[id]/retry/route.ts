import { retryOperation } from '@/lib/api/discord/operation-retry';
export async function POST(request: Request, {params}: {params: Promise<{id: string}>}) { return retryOperation(request, (await params).id); }
