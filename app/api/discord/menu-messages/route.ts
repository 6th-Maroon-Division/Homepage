import { menuMessages } from '@/lib/api/discord/menu-messages';
export async function GET(request: Request) { return menuMessages(request); }
