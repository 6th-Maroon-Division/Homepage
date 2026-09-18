import { userAvatar } from '@/lib/api/avatars';
export const runtime = 'nodejs';
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return userAvatar(request, (await context.params).id, 'upload');
}
