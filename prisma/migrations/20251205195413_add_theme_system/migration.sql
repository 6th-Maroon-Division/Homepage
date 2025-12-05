-- CreateEnum
CREATE TYPE "SubmissionStatus" AS ENUM ('pending', 'approved', 'rejected');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "selectedThemeId" INTEGER;

-- CreateTable
CREATE TABLE "Theme" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "isDefaultLight" BOOLEAN NOT NULL DEFAULT false,
    "isDefaultDark" BOOLEAN NOT NULL DEFAULT false,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "customCss" TEXT,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "background" TEXT NOT NULL,
    "foreground" TEXT NOT NULL,
    "primary" TEXT NOT NULL,
    "primaryForeground" TEXT NOT NULL,
    "secondary" TEXT NOT NULL,
    "secondaryForeground" TEXT NOT NULL,
    "accent" TEXT NOT NULL,
    "accentForeground" TEXT NOT NULL,
    "muted" TEXT NOT NULL,
    "mutedForeground" TEXT NOT NULL,
    "border" TEXT NOT NULL,

    CONSTRAINT "Theme_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ThemeSubmission" (
    "id" SERIAL NOT NULL,
    "themeId" INTEGER NOT NULL,
    "submittedById" INTEGER NOT NULL,
    "status" "SubmissionStatus" NOT NULL DEFAULT 'pending',
    "message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "ThemeSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Theme_name_key" ON "Theme"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Theme_createdById_key" ON "Theme"("createdById");

-- CreateIndex
CREATE INDEX "ThemeSubmission_themeId_idx" ON "ThemeSubmission"("themeId");

-- CreateIndex
CREATE INDEX "ThemeSubmission_submittedById_idx" ON "ThemeSubmission"("submittedById");

-- AddForeignKey
ALTER TABLE "Theme" ADD CONSTRAINT "Theme_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ThemeSubmission" ADD CONSTRAINT "ThemeSubmission_themeId_fkey" FOREIGN KEY ("themeId") REFERENCES "Theme"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ThemeSubmission" ADD CONSTRAINT "ThemeSubmission_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_selectedThemeId_fkey" FOREIGN KEY ("selectedThemeId") REFERENCES "Theme"("id") ON DELETE SET NULL ON UPDATE CASCADE;
