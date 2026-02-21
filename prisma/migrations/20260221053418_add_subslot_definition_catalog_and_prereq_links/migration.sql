-- AlterTable
ALTER TABLE "Subslot" ADD COLUMN     "requiredRankId" INTEGER,
ADD COLUMN     "requiredTrainingId" INTEGER,
ADD COLUMN     "subslotDefinitionId" INTEGER;

-- CreateTable
CREATE TABLE "SubslotDefinition" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "maxSignups" INTEGER NOT NULL DEFAULT 1,
    "requiredTrainingId" INTEGER,
    "requiredRankId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubslotDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SubslotDefinition_name_key" ON "SubslotDefinition"("name");

-- CreateIndex
CREATE INDEX "SubslotDefinition_requiredTrainingId_idx" ON "SubslotDefinition"("requiredTrainingId");

-- CreateIndex
CREATE INDEX "SubslotDefinition_requiredRankId_idx" ON "SubslotDefinition"("requiredRankId");

-- CreateIndex
CREATE INDEX "Subslot_subslotDefinitionId_idx" ON "Subslot"("subslotDefinitionId");

-- CreateIndex
CREATE INDEX "Subslot_requiredTrainingId_idx" ON "Subslot"("requiredTrainingId");

-- CreateIndex
CREATE INDEX "Subslot_requiredRankId_idx" ON "Subslot"("requiredRankId");

-- AddForeignKey
ALTER TABLE "Subslot" ADD CONSTRAINT "Subslot_subslotDefinitionId_fkey" FOREIGN KEY ("subslotDefinitionId") REFERENCES "SubslotDefinition"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubslotDefinition" ADD CONSTRAINT "SubslotDefinition_requiredTrainingId_fkey" FOREIGN KEY ("requiredTrainingId") REFERENCES "Training"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubslotDefinition" ADD CONSTRAINT "SubslotDefinition_requiredRankId_fkey" FOREIGN KEY ("requiredRankId") REFERENCES "Rank"("id") ON DELETE SET NULL ON UPDATE CASCADE;
