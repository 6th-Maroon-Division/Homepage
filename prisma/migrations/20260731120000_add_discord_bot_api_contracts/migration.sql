-- Shared platform-owned notification settings.
CREATE TABLE "UserNotificationPreference" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "orbatAnnouncements" BOOLEAN NOT NULL DEFAULT false,
    "trainingScheduled" BOOLEAN NOT NULL DEFAULT false,
    "trainingUpdated" BOOLEAN NOT NULL DEFAULT false,
    "trainingCancelled" BOOLEAN NOT NULL DEFAULT false,
    "trainingReminders" BOOLEAN NOT NULL DEFAULT false,
    "promotionAnnouncements" BOOLEAN NOT NULL DEFAULT false,
    "dmEnabled" BOOLEAN NOT NULL DEFAULT true,
    "channelMentionsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "UserNotificationPreference_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserNotificationPreference_userId_key" ON "UserNotificationPreference"("userId");
ALTER TABLE "UserNotificationPreference" ADD CONSTRAINT "UserNotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Guild-specific Discord rank role mapping.
CREATE TABLE "RankDiscordRole" (
    "id" SERIAL NOT NULL,
    "rankId" INTEGER NOT NULL,
    "guildId" TEXT NOT NULL,
    "discordRoleId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RankDiscordRole_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RankDiscordRole_rankId_guildId_key" ON "RankDiscordRole"("rankId", "guildId");
CREATE INDEX "RankDiscordRole_guildId_isActive_idx" ON "RankDiscordRole"("guildId", "isActive");
ALTER TABLE "RankDiscordRole" ADD CONSTRAINT "RankDiscordRole_rankId_fkey" FOREIGN KEY ("rankId") REFERENCES "Rank"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Discord interaction replay protection. Successful responses are retained for 24 hours.
CREATE TABLE "BotIdempotencyReceipt" (
    "id" SERIAL NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "responseStatus" INTEGER NOT NULL,
    "responseBody" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BotIdempotencyReceipt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BotIdempotencyReceipt_idempotencyKey_key" ON "BotIdempotencyReceipt"("idempotencyKey");
CREATE INDEX "BotIdempotencyReceipt_expiresAt_idx" ON "BotIdempotencyReceipt"("expiresAt");

-- Durable, cursor-addressable events consumed by the Discord bot.
CREATE TABLE "BotEvent" (
    "id" BIGSERIAL NOT NULL,
    "type" TEXT NOT NULL,
    "aggregate" TEXT NOT NULL,
    "aggregateId" TEXT,
    "payload" JSONB NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BotEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BotEvent_aggregate_id_idx" ON "BotEvent"("aggregate", "id");
CREATE INDEX "BotEvent_type_id_idx" ON "BotEvent"("type", "id");
CREATE INDEX "BotEvent_occurredAt_idx" ON "BotEvent"("occurredAt");
