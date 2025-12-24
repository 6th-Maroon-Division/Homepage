-- AlterTable
ALTER TABLE "Theme" ADD COLUMN     "button" TEXT,
ADD COLUMN     "buttonHover" TEXT;

-- AlterTable
ALTER TABLE "ThemeSubmission" ADD COLUMN     "snapshotButton" TEXT,
ADD COLUMN     "snapshotButtonHover" TEXT;
