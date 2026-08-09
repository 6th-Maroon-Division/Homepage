ALTER TABLE "OrbatTemplate"
ADD COLUMN "tempFrequencies" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN "isSideOp" BOOLEAN,
ADD COLUMN "timezone" TEXT;
