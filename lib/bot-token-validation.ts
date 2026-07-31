import { prisma } from './prisma';

/**
 * Validates a bot API token against the database
 * @param token - The token to validate
 * @returns Promise<boolean> - True if token is valid and active
 */
export async function validateBotToken(token: string): Promise<boolean> {
  if (!token) return false;

  try {
    const botToken = await prisma.botToken.findFirst({
      where: {
        token,
        isActive: true,
      },
    });

    if (botToken) {
      // Update last used timestamp
      await prisma.botToken.update({
        where: { id: botToken.id },
        data: { lastUsedAt: new Date() },
      });
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Validates bot token from request headers
 * @param request - NextRequest object
 * @returns Promise<boolean> - True if valid token found in Authorization header
 */
export async function validateBotTokenFromRequest(request: Request): Promise<boolean> {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return false;
  
  const token = authHeader.substring(7);
  return validateBotToken(token);
}

/**
 * Compatibility alias used by older route modules. Authentication is intentionally
 * database-only so revoked and inactive BotToken records always take effect.
 */
export async function validateBotTokenLegacy(request: Request): Promise<boolean> {
  return validateBotTokenFromRequest(request);
}
