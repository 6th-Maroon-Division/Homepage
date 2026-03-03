-- Deprecate legacy boolean admin flag in favor of permission model (`system:super_admin`)
ALTER TABLE "User" DROP COLUMN "isAdmin";
