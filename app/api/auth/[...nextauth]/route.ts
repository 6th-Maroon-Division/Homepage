import NextAuth from 'next-auth';
import type { AuthOptions, Session } from 'next-auth';
import type { JWT } from 'next-auth/jwt';
import { decode } from 'next-auth/jwt';
import DiscordProvider from 'next-auth/providers/discord';
import { cookies } from 'next/headers';
import { prisma } from '@/lib/prisma';
import { processPendingEventsForUser } from '@/lib/pending-events';
import { randomUUID } from 'node:crypto';
import { writeApiAudit } from '@/lib/api/audit';
import { parsePositiveId } from '@/lib/api/validation';

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
  createdAt?: Date;
  permissions?: Record<string, number>;
  provider?: string;
}

async function denyDiscordSignIn() {
  try { await writeApiAudit(prisma, { principal: null, correlationId: randomUUID(), method: 'GET', path: '/api/auth/callback/discord' }, { action: 'access.denied', resource: 'auth_transport', outcome: 'denied' }); }
  catch { console.error('Authentication denial audit unavailable'); }
  return false;
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
    async signIn({ account, profile }) {
      if (account?.provider !== 'discord' || !profile) return denyDiscordSignIn();
      const providerProfile = profile as DiscordProfile;
      if (typeof providerProfile.id !== 'string' || !/^\d{17,20}$/.test(providerProfile.id)) return denyDiscordSignIn();
      const providerUserId = providerProfile.id;
      const username = (typeof providerProfile.username === 'string' && providerProfile.username || typeof providerProfile.global_name === 'string' && providerProfile.global_name || 'Unknown').slice(0, 255);
      const email = typeof providerProfile.email === 'string' ? providerProfile.email : null;
      const avatarUrl = typeof providerProfile.image_url === 'string' && /^https:\/\//.test(providerProfile.image_url) ? providerProfile.image_url : null;
      const cookieStore = await cookies();
      const cookieName = process.env.NEXTAUTH_URL?.startsWith('https:') ? '__Secure-next-auth.session-token' : 'next-auth.session-token';
      const sessionToken = cookieStore.get(cookieName)?.value || cookieStore.getAll().filter(cookie => cookie.name.startsWith(`${cookieName}.`)).sort((a, b) => Number(a.name.split('.').at(-1)) - Number(b.name.split('.').at(-1))).map(cookie => cookie.value).join('');
      let existingUserId: number | null = null;
      if (sessionToken && process.env.NEXTAUTH_SECRET) {
        try {
          const decoded = await decode({ token: sessionToken, secret: process.env.NEXTAUTH_SECRET });
          existingUserId = parsePositiveId(decoded?.id);
          if (existingUserId !== null && existingUserId > 2147483647) return denyDiscordSignIn();
        } catch { return denyDiscordSignIn(); }
      }
      const refresh = cookieStore.get('discord-avatar-refresh')?.value === '1';
      const result = await prisma.$transaction(async tx => {
        let authAccount = await tx.authAccount.findUnique({ where: { provider_providerUserId: { provider: 'discord', providerUserId } }, include: { user: true } });
        if (existingUserId !== null) {
          const existing = await tx.user.findUnique({ where: { id: existingUserId } });
          if (!existing) return null;
          if (authAccount && authAccount.userId !== existingUserId) return null;
          if (!authAccount) {
            authAccount = await tx.authAccount.create({ data: { provider: 'discord', providerUserId, userId: existingUserId }, include: { user: true } });
            if (!existing.avatarUrl && avatarUrl) await tx.user.update({ where: { id: existingUserId }, data: { avatarUrl } });
          }
        } else if (!authAccount) {
          await tx.user.create({ data: { username, email, avatarUrl, accounts: { create: { provider: 'discord', providerUserId } } } });
          authAccount = await tx.authAccount.findUniqueOrThrow({ where: { provider_providerUserId: { provider: 'discord', providerUserId } }, include: { user: true } });
        }
        if (!authAccount) return null;
        if (refresh) await tx.user.update({ where: { id: authAccount.userId }, data: { username, email, avatarUrl } });
        await writeApiAudit(tx, { principal: { kind: 'user', userId: authAccount.userId, permissions: {} }, correlationId: randomUUID(), method: 'GET', path: '/api/auth/callback/discord' }, { action: existingUserId === null ? 'auth.discord.signed_in' : 'auth.discord.linked', resource: 'auth_account', resourceId: String(authAccount.id), targetUserIds: [authAccount.userId], outcome: 'success' });
        return authAccount.userId;
      });
      if (result === null) return denyDiscordSignIn();
      if (refresh) cookieStore.set('discord-avatar-refresh', '', { maxAge: 0, path: '/' });
      try { await processPendingEventsForUser(undefined, providerUserId, result, { principal: { kind: 'user', userId: result, permissions: {} }, correlationId: randomUUID(), method: 'GET', path: '/api/auth/callback/discord' }); } catch { console.error('Discord attendance backfill failed'); }
      return true;
    },

    async jwt({ token, trigger, account }) {
      const extended = token as ExtendedJWT;
      const shouldRefresh = trigger === 'signIn' || trigger === 'update' || typeof extended.id !== 'number';
      if (account?.provider === 'discord') extended.provider = 'discord';
      if (shouldRefresh) {
        // Never resolve a Discord subject through a Steam account with the same string ID.
        const currentId = parsePositiveId(extended.id);
        const linked = trigger === 'signIn' && account?.provider === 'discord' && token.sub
          ? await prisma.authAccount.findUnique({ where: { provider_providerUserId: { provider: 'discord', providerUserId: token.sub } }, include: { user: true } })
          : null;
        const user = linked?.user ?? (trigger !== 'signIn' && currentId !== null && currentId <= 2147483647 ? await prisma.user.findUnique({ where: { id: currentId } }) : null);
        if (!user) { delete extended.id; extended.permissions = {}; return token; }
        extended.id = user.id;
        extended.username = user.username;
        extended.email = user.email ?? null;
        extended.createdAt = user.createdAt;
        const grants = await prisma.userPermission.findMany({ where: { userId: user.id }, include: { permission: true } });
        extended.permissions = Object.fromEntries(grants.map(grant => [grant.permission.key, grant.value]));
      }
      return token;
    },

    async session({ session, token }: { session: Session; token: JWT }) {
      const extendedToken = token as ExtendedJWT;
      if (session.user) {
        session.user.id = extendedToken.id as number;
        session.user.username = extendedToken.username ?? null;
        session.user.email = extendedToken.email ?? null;
        // Don't include avatarUrl in session - it's fetched separately
        session.user.createdAt = extendedToken.createdAt as Date;
        session.user.permissions = extendedToken.permissions ?? {};
      }
      return session;
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
};

const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };