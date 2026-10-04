import { configuration } from '@/lib/api/discord/configuration';
export async function PATCH(request: Request) { return configuration(request, 'PATCH'); }
