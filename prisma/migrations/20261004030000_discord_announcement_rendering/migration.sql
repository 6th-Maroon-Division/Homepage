ALTER TABLE "DiscordAnnouncement"
ADD COLUMN "renderedRevision" TEXT,
ADD COLUMN "lastRenderedAt" TIMESTAMP(3),
ADD COLUMN "missingAt" TIMESTAMP(3);
