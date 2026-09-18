import { permissionTemplateRequest } from '@/lib/api/permission-templates';
export async function GET(request: Request) { return permissionTemplateRequest(request, 'list'); }
export async function POST(request: Request) { return permissionTemplateRequest(request, 'create'); }
