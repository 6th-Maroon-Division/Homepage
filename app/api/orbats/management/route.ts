import { getOrbatManagement } from '@/lib/api/orbat-management';
export async function GET(request: Request) { return getOrbatManagement(request); }
