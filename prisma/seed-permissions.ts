import { prisma } from "../lib/prisma";
import { PERMISSIONS } from "../lib/permissions";

/**
 * Seed all permissions into the database
 * Called during development and production seeding
 * Uses a transaction for atomicity and better performance
 */
export async function seedPermissions() {
  console.log("🔐 Seeding permissions...");

  await prisma.$transaction(async (tx) => {
    for (const [key, metadata] of Object.entries(PERMISSIONS)) {
      await tx.permission.upsert({
        where: { key },
        update: {
          description: metadata.description,
          defaultValue: metadata.defaultValue,
          maxValue: metadata.maxValue,
        },
        create: {
          key,
          description: metadata.description,
          defaultValue: metadata.defaultValue,
          maxValue: metadata.maxValue,
        },
      });
    }
  });

  console.log(`✅ Seeded ${Object.keys(PERMISSIONS).length} permissions`);
}

/**
 * Set admin user to have full permissions (255 for all)
 * Uses a transaction for atomicity and better performance
 */
export async function grantAdminPermissions(userId: number) {
  const adminPermKeys: string[] = [
    "user:edit",
    "user:promote",
    "user:manage",
    "user:manage_permissions",
    "training:create",
    "training:edit",
    "training:delete",
    "training:mark",
    "training:approve_request",
    "orbat:create",
    "orbat:edit",
    "orbat:delete",
    "template:create",
    "template:edit",
    "template:delete",
    "attendance:edit",
    "attendance:view",
    "rank:create",
    "rank:edit",
    "rank:delete",
    "rank:manage_promotions",
    "admin:system",
  ];

  await prisma.$transaction(async (tx) => {
    // Fetch all permissions at once
    const permissions = await tx.permission.findMany({
      where: {
        key: {
          in: adminPermKeys,
        },
      },
    });

    // Create permission map for faster lookup
    const permissionMap = new Map(permissions.map((p) => [p.key, p.id]));

    // Upsert all user permissions
    for (const key of adminPermKeys) {
      const permissionId = permissionMap.get(key);
      if (permissionId) {
        await tx.userPermission.upsert({
          where: {
            userId_permissionId: {
              userId,
              permissionId,
            },
          },
          update: { value: 255 },
          create: {
            userId,
            permissionId,
            value: 255,
          },
        });
      }
    }
  });

  console.log(`✅ Granted full admin permissions to user ${userId}`);
}
