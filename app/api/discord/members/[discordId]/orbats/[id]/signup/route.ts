import { memberOrbat } from '@/lib/api/discord/members';
export async function POST(request: Request, { params }: { params: Promise<{ discordId: string; id: string }> }) { return memberOrbat(request, (await params).discordId, (await params).id, 'signup', 'POST'); }
export async function PATCH(request: Request, { params }: { params: Promise<{ discordId: string; id: string }> }) { return memberOrbat(request, (await params).discordId, (await params).id, 'signup', 'PATCH'); }
export async function DELETE(request: Request, { params }: { params: Promise<{ discordId: string; id: string }> }) { return memberOrbat(request, (await params).discordId, (await params).id, 'signup', 'DELETE'); }
