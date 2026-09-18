import { orbatTemplateRequest } from '@/lib/api/orbat-templates';
export async function GET(request: Request) { return orbatTemplateRequest(request, 'access'); }
