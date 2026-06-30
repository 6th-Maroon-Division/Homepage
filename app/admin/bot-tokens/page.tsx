import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { checkPermission } from '@/lib/auth-middleware';
import { prisma } from '@/lib/prisma';
import BotTokensClient from './BotTokensClient';

export default async function BotTokensAdminPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return (
      <div className="p-6">
        <p style={{ color: 'var(--foreground)' }}>Unauthorized</p>
      </div>
    );
  }

  const hasPermission = await checkPermission(session.user.id, 'system:super_admin');
  if (!hasPermission) {
    return (
      <div className="p-6">
        <p style={{ color: 'var(--foreground)' }}>Forbidden - Super Admin access required</p>
      </div>
    );
  }

  // Fetch bot tokens from database
  const botTokens = await prisma.botToken.findMany({
    orderBy: { name: 'asc' },
    include: {
      createdBy: {
        select: { id: true, username: true },
      },
    },
  });

  // Mask the actual token values for security
  const safeBotTokens = botTokens.map(token => ({
    id: token.id,
    name: token.name,
    isActive: token.isActive,
    createdAt: token.createdAt.toISOString(),
    lastUsedAt: token.lastUsedAt?.toISOString() || null,
    createdBy: token.createdBy ? {
      id: token.createdBy.id,
      username: token.createdBy.username,
    } : null,
  }));

  return (
    <div className="min-h-screen p-6" style={{ backgroundColor: 'var(--background)' }}>
      <div className="max-w-4xl mx-auto">
        <h1 
          style={{ color: 'var(--foreground)' }} 
          className="text-3xl font-bold mb-6"
        >
          Bot API Tokens
        </h1>
        <BotTokensClient 
          initialTokens={safeBotTokens} 
          currentUserId={session.user.id}
        />
      </div>
    </div>
  );
}
