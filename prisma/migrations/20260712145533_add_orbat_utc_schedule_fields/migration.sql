-- AlterTable
ALTER TABLE "Orbat" ADD COLUMN     "endsAtUtc" TIMESTAMP(3),
ADD COLUMN     "startsAtUtc" TIMESTAMP(3),
ADD COLUMN     "timezone" TEXT;
