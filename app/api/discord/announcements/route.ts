import { announcementList } from '@/lib/api/discord/announcement-list';

export async function GET(request: Request) { return announcementList(request); }
