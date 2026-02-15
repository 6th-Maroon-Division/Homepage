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

  // --- Grant permissions to all existing admins ---
  console.log('🔐 Granting permissions to existing admin users...');
  
  const adminUsers = await prisma.user.findMany({
    where: { isAdmin: true },
  });

  for (const admin of adminUsers) {
    console.log(`   > Granting permissions to ${admin.username} (ID: ${admin.id})`);
    await grantAdminPermissions(admin.id);
  }

  console.log(`✅ Granted permissions to ${adminUsers.length} admin user(s)`);

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
