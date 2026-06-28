/* eslint-disable */
// @ts-nocheck
// prisma/seed.migrate.ts - Safe migration seed that preserves all existing data
// Use this when migrating production database to add permission system without data loss

import { prisma } from '../lib/prisma';
import { seedPermissions, grantAdminPermissions } from './seed-permissions';

async function main() {
  console.log('🔄 Running safe migration seed...');
  console.log('⚠️  This will PRESERVE all existing data');

  // --- Seed Permissions (idempotent, won't overwrite existing) ---
  await seedPermissions();

  // --- Grant permissions to existing super-admin users ---
  console.log('🔐 Granting permissions to super-admin users...');

  const hasIsAdminColumn = await prisma.$queryRawUnsafe<Array<{ exists: boolean }>>(`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_name = 'User' AND column_name = 'isAdmin'
    ) AS "exists"
  `);

  const adminUserIds = new Set<number>();

  if (hasIsAdminColumn[0]?.exists) {
    const legacyAdmins = await prisma.$queryRawUnsafe<Array<{ id: number; username: string | null }>>(
      'SELECT "id", "username" FROM "User" WHERE "isAdmin" = true'
    );
    for (const admin of legacyAdmins) {
      adminUserIds.add(admin.id);
      console.log(`   > Legacy admin detected: ${admin.username ?? 'Unknown'} (ID: ${admin.id})`);
    }
  }

  const permissionAdmins = await prisma.userPermission.findMany({
    where: {
      value: { gt: 0 },
      permission: { key: 'system:super_admin' },
    },
    select: { userId: true },
  });

  for (const admin of permissionAdmins) {
    adminUserIds.add(admin.userId);
  }

  if (adminUserIds.size === 0) {
    const firstUser = await prisma.user.findFirst({ orderBy: { id: 'asc' } });
    if (firstUser) {
      adminUserIds.add(firstUser.id);
      console.log(`   > Bootstrap super-admin fallback: ${firstUser.username ?? 'Unknown'} (ID: ${firstUser.id})`);
    }
  }

  for (const adminUserId of adminUserIds) {
    await grantAdminPermissions(adminUserId);
  }

  console.log(`✅ Granted permissions to ${adminUserIds.size} admin user(s)`);

  // --- Summary ---
  const permissionCount = await prisma.permission.count();
  const userCount = await prisma.user.count();
  const orbatCount = await prisma.orbat.count();
  const signupCount = await prisma.signup.count();

  console.log('\n📊 Database Status:');
  console.log(`   • Permissions: ${permissionCount}`);
  console.log(`   • Users: ${userCount}`);
  console.log(`   • ORBATs: ${orbatCount}`);
  console.log(`   • Signups: ${signupCount}`);

  console.log('\n✨ Migration seed complete!');
  console.log('All existing data has been preserved.');
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error('Error during migration seed:', e);
    await prisma.$disconnect();
    process.exit(1);
  });
