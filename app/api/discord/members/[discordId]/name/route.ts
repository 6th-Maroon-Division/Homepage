import { memberName } from '@/lib/api/discord/members';
export async function PATCH(request: Request, { params }: { params: Promise<{ discordId: string }> }) { return memberName(request, (await params).discordId); }
