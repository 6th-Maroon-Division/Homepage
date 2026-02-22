-- AlterTable
ALTER TABLE "Subslot" ADD COLUMN     "requiredRankIds" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
ADD COLUMN     "requiredTrainingIds" INTEGER[] DEFAULT ARRAY[]::INTEGER[];

-- AlterTable
ALTER TABLE "SubslotDefinition" ADD COLUMN     "requiredRankIds" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
ADD COLUMN     "requiredTrainingIds" INTEGER[] DEFAULT ARRAY[]::INTEGER[];
