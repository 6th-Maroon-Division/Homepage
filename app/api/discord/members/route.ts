import { members } from '@/lib/api/discord/members';
export async function GET(request: Request) { return members(request); }
