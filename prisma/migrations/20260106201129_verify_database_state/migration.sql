/*
  Warnings:

  - You are about to drop the column `selectedThemeId` on the `User` table. All the data in the column will be lost.
  - You are about to drop the `Theme` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `ThemeSubmission` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "Theme" DROP CONSTRAINT "Theme_createdById_fkey";

-- DropForeignKey
ALTER TABLE "Theme" DROP CONSTRAINT "Theme_parentThemeId_fkey";

-- DropForeignKey
ALTER TABLE "ThemeSubmission" DROP CONSTRAINT "ThemeSubmission_submittedById_fkey";

-- DropForeignKey
ALTER TABLE "ThemeSubmission" DROP CONSTRAINT "ThemeSubmission_themeId_fkey";

-- DropForeignKey
ALTER TABLE "User" DROP CONSTRAINT "User_selectedThemeId_fkey";

-- AlterTable
ALTER TABLE "User" DROP COLUMN "selectedThemeId";

-- DropTable
DROP TABLE "Theme";

-- DropTable
DROP TABLE "ThemeSubmission";

-- DropEnum
DROP TYPE "SubmissionStatus";

-- DropEnum
DROP TYPE "ThemeType";
