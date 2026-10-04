-- AlterTable
ALTER TABLE "User" ADD COLUMN     "nameRevision" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "DiscordIntegration" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "settings" JSONB NOT NULL,
    "appliedRevision" INTEGER NOT NULL DEFAULT 0,
    "lastSeenAt" TIMESTAMP(3),
    "botVersion" TEXT,
    "health" TEXT NOT NULL DEFAULT 'not_connected',
    "metadata" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiscordIntegration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscordCommand" (
    "id" SERIAL NOT NULL,
    "requestKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "permission" TEXT NOT NULL,
    "requestedBy" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "generation" INTEGER NOT NULL DEFAULT 1,
    "claimToken" TEXT,
    "claimedBy" INTEGER,
    "leaseUntil" TIMESTAMP(3),
    "result" JSONB,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiscordCommand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscordAnnouncement" (
    "id" SERIAL NOT NULL,
    "orbatId" INTEGER NOT NULL,
    "channelId" TEXT NOT NULL,
    "mention" TEXT NOT NULL DEFAULT 'none',
    "missionText" TEXT NOT NULL,
    "messageId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiscordAnnouncement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscordModerationCase" (
    "id" SERIAL NOT NULL,
    "triggerId" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "roleIds" JSONB NOT NULL,
    "configRevision" INTEGER NOT NULL,
    "configSnapshot" JSONB NOT NULL,
    "action" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "timeoutUntil" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),
    "cleanup" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiscordModerationCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscordEvidence" (
    "id" SERIAL NOT NULL,
    "caseId" INTEGER NOT NULL,
    "messageId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL,
    "content" TEXT,
    "attachments" JSONB,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "indefinite" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "recoverUntil" TIMESTAMP(3),
    "purgedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "DiscordEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DiscordCommand_requestKey_key" ON "DiscordCommand"("requestKey");

-- CreateIndex
CREATE INDEX "DiscordCommand_status_id_idx" ON "DiscordCommand"("status", "id");

-- CreateIndex
CREATE UNIQUE INDEX "DiscordAnnouncement_orbatId_key" ON "DiscordAnnouncement"("orbatId");

-- CreateIndex
CREATE UNIQUE INDEX "DiscordModerationCase_triggerId_key" ON "DiscordModerationCase"("triggerId");

-- CreateIndex
CREATE INDEX "DiscordEvidence_expiresAt_deletedAt_idx" ON "DiscordEvidence"("expiresAt", "deletedAt");

-- CreateIndex
CREATE INDEX "DiscordEvidence_recoverUntil_purgedAt_idx" ON "DiscordEvidence"("recoverUntil", "purgedAt");

-- CreateIndex
CREATE UNIQUE INDEX "DiscordEvidence_caseId_messageId_key" ON "DiscordEvidence"("caseId", "messageId");

-- AddForeignKey
ALTER TABLE "DiscordEvidence" ADD CONSTRAINT "DiscordEvidence_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "DiscordModerationCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
