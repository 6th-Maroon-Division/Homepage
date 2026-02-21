-- CreateEnum
CREATE TYPE "PermissionAction" AS ENUM ('GRANT', 'REVOKE', 'MODIFY');

-- CreateTable
CREATE TABLE "PermissionAuditLog" (
    "id" SERIAL NOT NULL,
    "actorId" INTEGER NOT NULL,
    "targetUserId" INTEGER NOT NULL,
    "permissionId" INTEGER NOT NULL,
    "action" "PermissionAction" NOT NULL,
    "oldValue" INTEGER,
    "newValue" INTEGER,
    "reason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PermissionAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PermissionAuditLog_actorId_idx" ON "PermissionAuditLog"("actorId");

-- CreateIndex
CREATE INDEX "PermissionAuditLog_targetUserId_idx" ON "PermissionAuditLog"("targetUserId");

-- CreateIndex
CREATE INDEX "PermissionAuditLog_permissionId_idx" ON "PermissionAuditLog"("permissionId");

-- CreateIndex
CREATE INDEX "PermissionAuditLog_createdAt_idx" ON "PermissionAuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "PermissionAuditLog_action_idx" ON "PermissionAuditLog"("action");

-- AddForeignKey
ALTER TABLE "PermissionAuditLog" ADD CONSTRAINT "PermissionAuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PermissionAuditLog" ADD CONSTRAINT "PermissionAuditLog_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PermissionAuditLog" ADD CONSTRAINT "PermissionAuditLog_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
