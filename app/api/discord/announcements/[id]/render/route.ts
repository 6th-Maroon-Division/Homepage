import { announcementRender } from '@/lib/api/discord/announcement-render';
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, { params }: Context) { return announcementRender(request, (await params).id, 'GET'); }
export async function POST(request: Request, { params }: Context) { return announcementRender(request, (await params).id, 'POST'); }
