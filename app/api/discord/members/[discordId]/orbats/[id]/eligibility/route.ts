import { memberOrbat } from '@/lib/api/discord/members';
export async function GET(request: Request, { params }: { params: Promise<{ discordId: string; id: string }> }) { return memberOrbat(request, (await params).discordId, (await params).id, 'eligibility', 'GET'); }
