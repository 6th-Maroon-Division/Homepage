-- CreateEnum
CREATE TYPE "FrequencyType" AS ENUM ('SR', 'LR');

-- AlterTable
ALTER TABLE "Orbat" ADD COLUMN     "tempFrequencies" JSONB DEFAULT '[]';

-- CreateTable
CREATE TABLE "RadioFrequency" (
    "id" SERIAL NOT NULL,
    "frequency" TEXT NOT NULL,
    "type" "FrequencyType" NOT NULL,
    "isAdditional" BOOLEAN NOT NULL DEFAULT false,
    "channel" TEXT,
    "callsign" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RadioFrequency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrbatRadioFrequency" (
    "id" SERIAL NOT NULL,
    "orbatId" INTEGER NOT NULL,
    "radioFrequencyId" INTEGER NOT NULL,

    CONSTRAINT "OrbatRadioFrequency_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RadioFrequency_frequency_key" ON "RadioFrequency"("frequency");

-- CreateIndex
CREATE INDEX "OrbatRadioFrequency_orbatId_idx" ON "OrbatRadioFrequency"("orbatId");

-- CreateIndex
CREATE UNIQUE INDEX "OrbatRadioFrequency_orbatId_radioFrequencyId_key" ON "OrbatRadioFrequency"("orbatId", "radioFrequencyId");

-- AddForeignKey
ALTER TABLE "OrbatRadioFrequency" ADD CONSTRAINT "OrbatRadioFrequency_orbatId_fkey" FOREIGN KEY ("orbatId") REFERENCES "Orbat"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrbatRadioFrequency" ADD CONSTRAINT "OrbatRadioFrequency_radioFrequencyId_fkey" FOREIGN KEY ("radioFrequencyId") REFERENCES "RadioFrequency"("id") ON DELETE CASCADE ON UPDATE CASCADE;
