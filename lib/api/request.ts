export class InvalidJsonBody extends Error {}

export async function readJsonBody(request: Request): Promise<unknown> {
  try { return await request.json(); }
  catch { throw new InvalidJsonBody('Request body must be valid JSON.'); }
}
