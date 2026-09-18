import { test as base, expect, type BrowserContext } from '@playwright/test';
import { encode } from 'next-auth/jwt';
import { PrismaPg } from '@prisma/adapter-pg';
import { PERMISSIONS } from '../../lib/permissions';

if (process.env.UI_TEST_MODE !== '1' || !process.env.UI_TEST_DATABASE_URL || process.env.DATABASE_URL !== process.env.UI_TEST_DATABASE_URL || !process.env.UI_TEST_PRISMA_CLIENT) throw new Error('Isolated UI database and generated client required.');
const { PrismaClient } = await import(process.env.UI_TEST_PRISMA_CLIENT) as typeof import('../../generated/prisma/client');
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.UI_TEST_DATABASE_URL, max: 1, maxUses: 1 }) });

type Seed = { adminId: number; memberId: number; roleId: number; orbatId: number };
export const test = base.extend<{ login: (role?: 'admin' | 'member') => Promise<void>; browserErrors: void }, { seed: Seed; db: typeof db }>({
  browserErrors: [async ({ context }, use) => {
    const errors: string[] = [];
    context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
    await use();
    expect(errors, 'No uncaught browser errors').toEqual([]);
  }, { auto: true }],
  db: [async ({}, use) => { await use(db); await db.$disconnect(); }, { scope: 'worker' }],
  seed: [async ({ db }, use) => {
    for (const [key, metadata] of Object.entries(PERMISSIONS)) {
      await db.permission.upsert({ where: { key }, create: { key, ...metadata }, update: {} });
    }
    const catalog = await db.permission.findMany();
    const admin = await db.user.create({ data: { username: 'Browser Admin', userPermissions: { create: catalog.map(item => ({ permissionId: item.id, value: item.maxValue })) } } });
    const member = await db.user.create({ data: { username: 'Browser Member' } });
    // Seed complete local identities so the real account-linking guard permits
    // normal UI interactions; external provider sign-in is not bypassed in app code.
    for (const user of [admin, member]) {
      await db.authAccount.createMany({ data: [
        { userId: user.id, provider: 'steam', providerUserId: `ui-steam-${user.id}` },
        { userId: user.id, provider: 'discord', providerUserId: `ui-discord-${user.id}` },
      ] });
    }
    const role = await db.squadRole.upsert({ where: { name: 'Browser Rifleman' }, create: { name: 'Browser Rifleman' }, update: {} });
    const orbat = await db.orbat.create({ data: { name: 'Browser Public Operation', description: 'Public operation briefing', startsAtUtc: new Date('2099-07-20T17:00:00Z'), eventDate: new Date('2099-07-20T17:00:00Z'), timezone: 'Europe/Berlin', createdById: admin.id } });
    const squad = await db.squad.create({ data: { name: 'Alpha', orbatId: orbat.id, orderIndex: 0 } });
    await db.slot.create({ data: { orbatId: orbat.id, squadId: squad.id, squadRoleId: role.id, orderIndex: 0, maxSignups: 1 } });
    await use({ adminId: admin.id, memberId: member.id, roleId: role.id, orbatId: orbat.id });
  }, { scope: 'worker' }],
  login: async ({ context, seed }, use) => {
    await use(async (role = 'admin') => signIn(context, role === 'admin' ? seed.adminId : seed.memberId, role === 'admin'));
  },
});
async function signIn(context: BrowserContext, id: number, admin: boolean) {
  const grants = await db.userPermission.findMany({ where: { userId: id }, include: { permission: true } });
  const permissions = Object.fromEntries(grants.map(grant => [grant.permission.key, grant.value]));
  const token = await encode({ secret: process.env.NEXTAUTH_SECRET!, token: { id, sub: String(id), name: admin ? 'Browser Admin' : 'Browser Member', username: admin ? 'Browser Admin' : 'Browser Member', permissions }, maxAge: 3600 });
  await context.addCookies([{ name: 'next-auth.session-token', value: token, url: process.env.UI_TEST_BASE_URL!, httpOnly: true, sameSite: 'Lax' }]);
}
export { expect };
