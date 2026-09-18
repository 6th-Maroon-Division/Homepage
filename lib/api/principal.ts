import type { PermissionGrants } from './permissions';
import { parsePositiveId } from './validation';

export type ApiPrincipal =
  | { kind: 'user'; userId: number; permissions: PermissionGrants }
  | { kind: 'bot'; tokenId: number; permissions: PermissionGrants };

export type PrincipalDependencies = {
  findBot: (token: string) => Promise<{ id: number; permissions: PermissionGrants } | null>;
  touchBot: (id: number) => Promise<void>;
  sessionUserId: () => Promise<unknown>;
  findUser: (id: number) => Promise<{ permissions: PermissionGrants } | null>;
};

/** Explicit Authorization always takes precedence; invalid bearer credentials
 * never fall back to a more privileged browser session. */
export async function resolveApiPrincipal(request: Request, dependencies: PrincipalDependencies): Promise<ApiPrincipal | null> {
  const authorization = request.headers.get('authorization');
  if (authorization !== null) {
    const match = /^Bearer ([^\s]+)$/i.exec(authorization);
    if (!match) return null;
    const bot = await dependencies.findBot(match[1]);
    if (!bot) return null;
    await dependencies.touchBot(bot.id);
    return { kind: 'bot', tokenId: bot.id, permissions: bot.permissions };
  }
  const userId = parsePositiveId(await dependencies.sessionUserId());
  if (userId === null) return null;
  const user = await dependencies.findUser(userId);
  return user ? { kind: 'user', userId, permissions: user.permissions } : null;
}
