-- CreateEnum
CREATE TYPE "ThemeType" AS ENUM ('original', 'derived');

-- DropIndex
DROP INDEX "Theme_createdById_key";

-- DropIndex
DROP INDEX "Theme_name_key";

-- AlterTable
ALTER TABLE "Theme" ADD COLUMN     "parentThemeId" INTEGER,
ADD COLUMN     "type" "ThemeType" NOT NULL DEFAULT 'original';

-- AlterTable
ALTER TABLE "ThemeSubmission" ADD COLUMN     "adminMessage" TEXT;

-- CreateIndex
CREATE INDEX "Theme_createdById_idx" ON "Theme"("createdById");

-- CreateIndex
CREATE INDEX "Theme_parentThemeId_idx" ON "Theme"("parentThemeId");

-- AddForeignKey
ALTER TABLE "Theme" ADD CONSTRAINT "Theme_parentThemeId_fkey" FOREIGN KEY ("parentThemeId") REFERENCES "Theme"("id") ON DELETE CASCADE ON UPDATE CASCADE;
