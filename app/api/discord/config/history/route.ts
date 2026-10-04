import { configurationHistory } from '@/lib/api/discord/config-history';
export async function GET(request: Request) { return configurationHistory(request); }
