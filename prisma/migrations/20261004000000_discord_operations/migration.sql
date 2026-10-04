CREATE TABLE "DiscordOperation" (
    "id" SERIAL NOT NULL,
    "eventId" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "configRevision" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL,
    "memberId" TEXT,
    "channelId" TEXT,
    "roleId" TEXT,
    "menuId" TEXT,
    "errorCode" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DiscordOperation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DiscordOperation_eventId_key" ON "DiscordOperation"("eventId");
CREATE INDEX "DiscordOperation_status_id_idx" ON "DiscordOperation"("status", "id");
CREATE INDEX "DiscordOperation_kind_id_idx" ON "DiscordOperation"("kind", "id");
