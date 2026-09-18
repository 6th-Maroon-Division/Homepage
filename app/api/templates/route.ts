import { orbatTemplateRequest } from '@/lib/api/orbat-templates';
export async function GET(request: Request) { return orbatTemplateRequest(request, 'list'); }
export async function POST(request: Request) { return orbatTemplateRequest(request, 'create'); }
