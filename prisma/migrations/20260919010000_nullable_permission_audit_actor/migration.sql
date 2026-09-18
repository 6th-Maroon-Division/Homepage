-- DropForeignKey
ALTER TABLE "PermissionAuditLog" DROP CONSTRAINT "PermissionAuditLog_actorId_fkey";

-- AlterTable
ALTER TABLE "PermissionAuditLog" ALTER COLUMN "actorId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "PermissionAuditLog" ADD CONSTRAINT "PermissionAuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

