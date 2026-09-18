import { decidePromotion } from '@/lib/api/promotion-decisions';
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return decidePromotion(request, (await params).id, 'approved');
}
