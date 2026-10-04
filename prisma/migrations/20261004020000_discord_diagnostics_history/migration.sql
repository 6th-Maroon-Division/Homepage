ALTER TABLE "DiscordIntegration"
ADD COLUMN "metadataObservedAt" TIMESTAMP(3),
ADD COLUMN "diagnostics" JSONB,
ADD COLUMN "diagnosticsReportedAt" TIMESTAMP(3);
CREATE TABLE "DiscordConfigurationRevision" (
  "id" SERIAL NOT NULL,
  "revision" INTEGER NOT NULL,
  "settings" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DiscordConfigurationRevision_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DiscordConfigurationRevision_revision_key" ON "DiscordConfigurationRevision"("revision");
INSERT INTO "DiscordConfigurationRevision" ("revision", "settings")
SELECT "revision", "settings"->'settings' FROM "DiscordIntegration"
WHERE "revision" > 0 AND jsonb_typeof("settings"->'settings') = 'object';
