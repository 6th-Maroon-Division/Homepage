import { announcement } from '@/lib/api/discord/announcements';
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) { return announcement(request, (await params).id, 'GET'); }
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) { return announcement(request, (await params).id, 'POST'); }
