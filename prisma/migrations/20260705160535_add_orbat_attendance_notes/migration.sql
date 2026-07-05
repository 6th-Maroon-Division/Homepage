-- CreateEnum
CREATE TYPE "OrbatAttendanceNoteStatus" AS ENUM ('absent', 'late_unsure');

-- CreateTable
CREATE TABLE "OrbatAttendanceNote" (
    "id" SERIAL NOT NULL,
    "orbatId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "status" "OrbatAttendanceNoteStatus" NOT NULL,
    "reason" TEXT,
    "lateMinutes" INTEGER,
    "leaveEarlyMinutes" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrbatAttendanceNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrbatAttendanceNote_orbatId_idx" ON "OrbatAttendanceNote"("orbatId");

-- CreateIndex
CREATE INDEX "OrbatAttendanceNote_userId_idx" ON "OrbatAttendanceNote"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "OrbatAttendanceNote_orbatId_userId_key" ON "OrbatAttendanceNote"("orbatId", "userId");

-- AddForeignKey
ALTER TABLE "OrbatAttendanceNote" ADD CONSTRAINT "OrbatAttendanceNote_orbatId_fkey" FOREIGN KEY ("orbatId") REFERENCES "Orbat"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrbatAttendanceNote" ADD CONSTRAINT "OrbatAttendanceNote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
