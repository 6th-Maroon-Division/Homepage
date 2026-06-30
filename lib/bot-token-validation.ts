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
 * Legacy validation: checks against BOT_API_TOKEN environment variable first,
 * then falls back to database validation. This ensures backward compatibility.
 */
export async function validateBotTokenLegacy(request: Request): Promise<boolean> {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return false;
  
  const token = authHeader.substring(7);
  
  // First check environment variable for backward compatibility
  if (process.env.BOT_API_TOKEN && token === process.env.BOT_API_TOKEN) {
    return true;
  }
  
  // Fall back to database validation
  return validateBotToken(token);
}
