-- CreateTable
CREATE TABLE "OrbatTemplate" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "tagsJson" TEXT,
    "slotsJson" JSONB NOT NULL,
    "frequencyIds" INTEGER[],
    "bluforCountry" TEXT,
    "bluforRelationship" TEXT,
    "opforCountry" TEXT,
    "opforRelationship" TEXT,
    "indepCountry" TEXT,
    "indepRelationship" TEXT,
    "iedThreat" TEXT,
    "civilianRelationship" TEXT,
    "rulesOfEngagement" TEXT,
    "airspace" TEXT,
    "inGameTimezone" TEXT,
    "operationDay" TEXT,
    "startTime" TEXT,
    "endTime" TEXT,
    "createdById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "OrbatTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrbatTemplate_name_key" ON "OrbatTemplate"("name");

-- AddForeignKey
ALTER TABLE "OrbatTemplate" ADD CONSTRAINT "OrbatTemplate_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
