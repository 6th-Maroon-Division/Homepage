import NextAuth from 'next-auth';
import DiscordProvider from 'next-auth/providers/discord';
import { prisma } from '@/lib/prisma';

export const authOptions = {
  providers: [
    DiscordProvider({
      clientId: process.env.DISCORD_CLIENT_ID!,
      clientSecret: process.env.DISCORD_CLIENT_SECRET!,
    }),
  ],
  callbacks: {
    async signIn({ user, account, profile }: any) {
      if (!account || !profile) return false;

      // Check if this Discord account already exists
      let authAccount = await prisma.authAccount.findUnique({
        where: {
          provider_providerUserId: {
            provider: 'discord',
            providerUserId: profile.id,
          },
        },
        include: { user: true },
      });

      if (!authAccount) {
        // Create new user and link Discord account
        const newUser = await prisma.user.create({
          data: {
            username: profile.username || profile.global_name || user.name,
            email: user.email,
            avatarUrl: user.image,
            accounts: {
              create: {
                provider: 'discord',
                providerUserId: profile.id,
              },
            },
          },
        });
      }

      return true;
    },

    async jwt({ token, profile, trigger }: any) {
      // On signin or profile update, fetch user from database
      if (profile || trigger === 'signIn' || trigger === 'update') {
        const providerUserId = profile?.id || token.sub;
        
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
            token.id = authAccount.user.id;
            token.username = authAccount.user.username;
            token.email = authAccount.user.email;
          }
        }
      }
      return token;
    },

    async session({ session, token }: any) {
      if (session.user) {
        session.user.id = token.id;
        session.user.username = token.username;
        session.user.email = token.email;
      }
      return session;
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
};

const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };