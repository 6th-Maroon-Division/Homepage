/*
  Warnings:

  - You are about to drop the `PendingAttendanceEvent` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "AttendanceEvent" DROP CONSTRAINT "AttendanceEvent_userId_fkey";

-- AlterTable
ALTER TABLE "AttendanceEvent" ADD COLUMN     "discordId" TEXT,
ADD COLUMN     "processed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "steamId" TEXT,
ALTER COLUMN "userId" DROP NOT NULL;

-- DropTable
DROP TABLE "PendingAttendanceEvent";

-- CreateIndex
CREATE INDEX "AttendanceEvent_steamId_idx" ON "AttendanceEvent"("steamId");

-- CreateIndex
CREATE INDEX "AttendanceEvent_discordId_idx" ON "AttendanceEvent"("discordId");

-- CreateIndex
CREATE INDEX "AttendanceEvent_processed_idx" ON "AttendanceEvent"("processed");

-- AddForeignKey
ALTER TABLE "AttendanceEvent" ADD CONSTRAINT "AttendanceEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
