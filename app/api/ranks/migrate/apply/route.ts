import { migrateRanks } from '@/lib/api/rank-migration';
export async function POST(request: Request) { return migrateRanks(request, true); }
