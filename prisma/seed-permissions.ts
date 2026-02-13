import { prisma } from "../lib/prisma";
import { PERMISSIONS } from "../lib/permissions";

/**
 * Seed all permissions into the database
 * Called during development and production seeding
 */
export async function seedPermissions() {
  console.log("🔐 Seeding permissions...");

  for (const [key, metadata] of Object.entries(PERMISSIONS)) {
    const existing = await prisma.permission.findUnique({
      where: { key },
    });

    if (existing) {
      // Update if exists
      await prisma.permission.update({
        where: { key },
        data: {
          description: metadata.description,
          defaultValue: metadata.defaultValue,
          maxValue: metadata.maxValue,
        },
      });
    } else {
      // Create if doesn't exist
      await prisma.permission.create({
        data: {
          key,
          description: metadata.description,
          defaultValue: metadata.defaultValue,
          maxValue: metadata.maxValue,
        },
      });
    }
  }

  console.log(`✅ Seeded ${Object.keys(PERMISSIONS).length} permissions`);
}

/**
 * Set admin user to have full permissions (255 for all)
 */
export async function grantAdminPermissions(userId: number) {
  const adminPermKeys = [
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
    "attendance:edit",
    "attendance:view",
    "rank:create",
    "rank:edit",
    "rank:delete",
    "rank:manage_promotions",
    "admin:system",
  ] as const;

  for (const key of adminPermKeys) {
    const permission = await prisma.permission.findUnique({
      where: { key },
    });

    if (permission) {
      await prisma.userPermission.upsert({
        where: {
          userId_permissionId: {
            userId,
            permissionId: permission.id,
          },
        },
        update: { value: 255 },
        create: {
          userId,
          permissionId: permission.id,
          value: 255,
        },
      });
    }
  }

  console.log(`✅ Granted full admin permissions to user ${userId}`);
}
