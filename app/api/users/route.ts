import { getUserDirectory } from '@/lib/api/user-directory';
export async function GET(request: Request) { return getUserDirectory(request); }
