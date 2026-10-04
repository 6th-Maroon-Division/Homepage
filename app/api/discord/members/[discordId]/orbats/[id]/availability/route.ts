import { memberOrbat } from '@/lib/api/discord/members';
export async function GET(request: Request, { params }: { params: Promise<{ discordId: string; id: string }> }) { return memberOrbat(request, (await params).discordId, (await params).id, 'availability', 'GET'); }
export async function PATCH(request: Request, { params }: { params: Promise<{ discordId: string; id: string }> }) { return memberOrbat(request, (await params).discordId, (await params).id, 'availability', 'PATCH'); }
export async function DELETE(request: Request, { params }: { params: Promise<{ discordId: string; id: string }> }) { return memberOrbat(request, (await params).discordId, (await params).id, 'availability', 'DELETE'); }
