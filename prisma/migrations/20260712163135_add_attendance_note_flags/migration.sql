-- AlterTable
ALTER TABLE "Attendance" ADD COLUMN     "notedAbsent" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "notedLateEarly" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "notedUnsure" BOOLEAN NOT NULL DEFAULT false;
