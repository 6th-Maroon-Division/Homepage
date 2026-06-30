-- CreateTable
CREATE TABLE "PendingAttendanceEvent" (
    "id" SERIAL NOT NULL,
    "steamId" TEXT,
    "discordId" TEXT,
    "isJoin" BOOLEAN NOT NULL,
    "eventTime" TIMESTAMP(3) NOT NULL,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PendingAttendanceEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PendingAttendanceEvent_steamId_idx" ON "PendingAttendanceEvent"("steamId");

-- CreateIndex
CREATE INDEX "PendingAttendanceEvent_discordId_idx" ON "PendingAttendanceEvent"("discordId");

-- CreateIndex
CREATE INDEX "PendingAttendanceEvent_isJoin_idx" ON "PendingAttendanceEvent"("isJoin");

-- CreateIndex
CREATE INDEX "PendingAttendanceEvent_processedAt_idx" ON "PendingAttendanceEvent"("processedAt");
