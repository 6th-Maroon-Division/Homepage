/*
  Warnings:

  - Added the required column `snapshotAccent` to the `ThemeSubmission` table without a default value. This is not possible if the table is not empty.
  - Added the required column `snapshotAccentForeground` to the `ThemeSubmission` table without a default value. This is not possible if the table is not empty.
  - Added the required column `snapshotBackground` to the `ThemeSubmission` table without a default value. This is not possible if the table is not empty.
  - Added the required column `snapshotBorder` to the `ThemeSubmission` table without a default value. This is not possible if the table is not empty.
  - Added the required column `snapshotForeground` to the `ThemeSubmission` table without a default value. This is not possible if the table is not empty.
  - Added the required column `snapshotMuted` to the `ThemeSubmission` table without a default value. This is not possible if the table is not empty.
  - Added the required column `snapshotMutedForeground` to the `ThemeSubmission` table without a default value. This is not possible if the table is not empty.
  - Added the required column `snapshotName` to the `ThemeSubmission` table without a default value. This is not possible if the table is not empty.
  - Added the required column `snapshotPrimary` to the `ThemeSubmission` table without a default value. This is not possible if the table is not empty.
  - Added the required column `snapshotPrimaryForeground` to the `ThemeSubmission` table without a default value. This is not possible if the table is not empty.
  - Added the required column `snapshotSecondary` to the `ThemeSubmission` table without a default value. This is not possible if the table is not empty.
  - Added the required column `snapshotSecondaryForeground` to the `ThemeSubmission` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "ThemeSubmission" ADD COLUMN     "snapshotAccent" TEXT NOT NULL,
ADD COLUMN     "snapshotAccentForeground" TEXT NOT NULL,
ADD COLUMN     "snapshotBackground" TEXT NOT NULL,
ADD COLUMN     "snapshotBorder" TEXT NOT NULL,
ADD COLUMN     "snapshotCustomCss" TEXT,
ADD COLUMN     "snapshotForeground" TEXT NOT NULL,
ADD COLUMN     "snapshotMuted" TEXT NOT NULL,
ADD COLUMN     "snapshotMutedForeground" TEXT NOT NULL,
ADD COLUMN     "snapshotName" TEXT NOT NULL,
ADD COLUMN     "snapshotPrimary" TEXT NOT NULL,
ADD COLUMN     "snapshotPrimaryForeground" TEXT NOT NULL,
ADD COLUMN     "snapshotSecondary" TEXT NOT NULL,
ADD COLUMN     "snapshotSecondaryForeground" TEXT NOT NULL;
