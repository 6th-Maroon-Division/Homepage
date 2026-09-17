-- CreateTable
CREATE TABLE "ApiAuditLog" (
    "id" SERIAL NOT NULL,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "correlationId" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorUserId" INTEGER,
    "actorTokenId" INTEGER,
    "action" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "resourceId" TEXT,
    "targetUserIds" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,

    CONSTRAINT "ApiAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ApiAuditLog_occurredAt_id_idx" ON "ApiAuditLog"("occurredAt", "id");

-- CreateIndex
CREATE INDEX "ApiAuditLog_actorUserId_occurredAt_idx" ON "ApiAuditLog"("actorUserId", "occurredAt");

-- CreateIndex
CREATE INDEX "ApiAuditLog_actorTokenId_occurredAt_idx" ON "ApiAuditLog"("actorTokenId", "occurredAt");

-- CreateIndex
CREATE INDEX "ApiAuditLog_resource_resourceId_idx" ON "ApiAuditLog"("resource", "resourceId");
