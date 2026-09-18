import { orbatTemplateRequest } from '@/lib/api/orbat-templates';
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) { return orbatTemplateRequest(request, 'read', (await context.params).id); }
export async function PATCH(request: Request, context: Context) { return orbatTemplateRequest(request, 'update', (await context.params).id); }
export async function DELETE(request: Request, context: Context) { return orbatTemplateRequest(request, 'delete', (await context.params).id); }
