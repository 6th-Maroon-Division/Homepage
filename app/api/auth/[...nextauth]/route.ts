import NextAuth from 'next-auth';
import type { AuthOptions, Session } from 'next-auth';
import type { JWT } from 'next-auth/jwt';
import DiscordProvider from 'next-auth/providers/discord';
import { prisma } from '@/lib/prisma';

interface DiscordProfile {
  id: string;
  username: string;
  global_name?: string;
  email?: string;
  image_url?: string;
}

interface ExtendedJWT extends JWT {
  id?: number;
  username?: string | null;
  email?: string | null;
  avatarUrl?: string | null;
  isAdmin?: boolean;
  createdAt?: Date;
}

export const authOptions: AuthOptions = {
  providers: [
    DiscordProvider({
      clientId: process.env.DISCORD_CLIENT_ID!,
      clientSecret: process.env.DISCORD_CLIENT_SECRET!,
    }),
    // Steam uses OpenID 2.0 which doesn't work well with NextAuth's OAuth flow
    // We'll handle it with a custom page that redirects to Steam
  ],
  callbacks: {
    async signIn({ account, profile, user }) {
      if (!account || !profile) return false;

      const provider = account.provider as 'discord' | 'steam';
      let providerUserId: string;
      let username: string;
      let email: string | null = null;
      let avatarUrl: string | null = null;

      if (provider === 'discord') {
        const discordProfile = profile as DiscordProfile;
        providerUserId = discordProfile.id;
        username = discordProfile.username || discordProfile.global_name || 'Unknown';
        email = discordProfile.email || null;
        avatarUrl = discordProfile.image_url || null;
      } else {
        return false;
      }

      // Check if this Discord account already exists
      const authAccount = await prisma.authAccount.findUnique({
        where: {
          provider_providerUserId: {
            provider,
            providerUserId,
          },
        },
        include: { user: true },
      });

      // Check if we have an existing session (for account linking)
      // We need to look up the actual database user ID, not use the provider ID
      let existingUserId: number | null = null;
      if (user?.id) {
        // Try to find an existing user by checking all their auth accounts
        const existingAccount = await prisma.authAccount.findFirst({
          where: {
            OR: [
              { provider: 'discord', providerUserId: user.id },
              { provider: 'steam', providerUserId: user.id },
            ],
          },
          select: { userId: true },
        });
        existingUserId = existingAccount?.userId ?? null;
      }

      if (!authAccount) {
        if (existingUserId) {
          // User is already logged in - link Discord account to existing user
          await prisma.authAccount.create({
            data: {
              provider,
              providerUserId,
              userId: existingUserId,
            },
          });

          // Update user's avatar if they don't have one
          const existingUser = await prisma.user.findUnique({ where: { id: existingUserId } });
          if (!existingUser?.avatarUrl && avatarUrl) {
            await prisma.user.update({
              where: { id: existingUserId },
              data: { avatarUrl },
            });
          }
        } else {
          // Create new user and link the account
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const newUser = await prisma.user.create({
            data: {
              username,
              email,
              avatarUrl,
              accounts: {
                create: {
                  provider,
                  providerUserId,
                },
              },
            },
          });
        }
      }

      return true;
    },

    async jwt({ token, profile, trigger }) {
      // Always refresh user data from database to ensure consistency
      // This handles cases where the database was reset or user data changed
      const shouldRefresh = profile || trigger === 'signIn' || trigger === 'update' || !token.id;
      
      if (shouldRefresh && token.sub) {
        // Try to find the user by checking both Discord and Steam accounts
        const steamAccount = await prisma.authAccount.findUnique({
          where: {
            provider_providerUserId: {
              provider: 'steam',
              providerUserId: token.sub,
            },
          },
          include: { user: true },
        });

        const discordAccount = await prisma.authAccount.findUnique({
          where: {
            provider_providerUserId: {
              provider: 'discord',
              providerUserId: token.sub,
            },
          },
          include: { user: true },
        });

        const authAccount = steamAccount || discordAccount;

        if (authAccount) {
          const extendedToken = token as ExtendedJWT;
          extendedToken.id = authAccount.user.id;
          extendedToken.username = authAccount.user.username;
          extendedToken.email = authAccount.user.email ?? null;
          extendedToken.avatarUrl = authAccount.user.avatarUrl;
          extendedToken.isAdmin = authAccount.user.isAdmin;
          extendedToken.createdAt = authAccount.user.createdAt;
        }
      }
      return token;
    },

    async session({ session, token }: { session: Session; token: JWT }) {
      const extendedToken = token as ExtendedJWT;
      if (session.user) {
        session.user.id = extendedToken.id as number;
        session.user.username = extendedToken.username ?? null;
        session.user.email = extendedToken.email ?? null;
        session.user.avatarUrl = extendedToken.avatarUrl ?? null;
        session.user.isAdmin = extendedToken.isAdmin as boolean;
        session.user.createdAt = extendedToken.createdAt as Date;
      }
      return session;
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
};

const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };