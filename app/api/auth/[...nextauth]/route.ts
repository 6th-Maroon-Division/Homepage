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
  ],
  callbacks: {
    async signIn({ account, profile }) {
      if (!account || !profile) return false;

      const discordProfile = profile as DiscordProfile;

      // Check if this Discord account already exists
      const authAccount = await prisma.authAccount.findUnique({
        where: {
          provider_providerUserId: {
            provider: 'discord',
            providerUserId: discordProfile.id,
          },
        },
        include: { user: true },
      });

      if (!authAccount) {
        // Create new user and link Discord account
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const newUser = await prisma.user.create({
          data: {
            username: discordProfile.username || discordProfile.global_name,
            email: discordProfile.email,
            avatarUrl: discordProfile.image_url,
            accounts: {
              create: {
                provider: 'discord',
                providerUserId: discordProfile.id,
              },
            },
          },
        });
      }

      return true;
    },

    async jwt({ token, profile, trigger }) {
      // On signin or profile update, fetch user from database
      if (profile || trigger === 'signIn' || trigger === 'update') {
        const discordProfile = profile as DiscordProfile | undefined;
        const providerUserId = discordProfile?.id || token.sub;
        
        if (providerUserId) {
          const authAccount = await prisma.authAccount.findUnique({
            where: {
              provider_providerUserId: {
                provider: 'discord',
                providerUserId: providerUserId,
              },
            },
            include: { user: true },
          });

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