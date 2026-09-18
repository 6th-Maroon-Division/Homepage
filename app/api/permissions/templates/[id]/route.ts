import { permissionTemplateRequest } from '@/lib/api/permission-templates';
type Context = { params: Promise<{ id: string }> };
export async function PATCH(request: Request, context: Context) { return permissionTemplateRequest(request, 'update', (await context.params).id); }
export async function DELETE(request: Request, context: Context) { return permissionTemplateRequest(request, 'delete', (await context.params).id); }
