-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('present', 'absent', 'late', 'gone_early', 'partial', 'no_show');

-- CreateTable
CREATE TABLE "Attendance" (
    "id" SERIAL NOT NULL,
    "signupId" INTEGER,
    "orbatId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "status" "AttendanceStatus" NOT NULL DEFAULT 'absent',
    "minutesLate" INTEGER NOT NULL DEFAULT 0,
    "minutesGoneEarly" INTEGER NOT NULL DEFAULT 0,
    "totalMinutesMissed" INTEGER NOT NULL DEFAULT 0,
    "totalMinutesPresent" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Attendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceSession" (
    "id" SERIAL NOT NULL,
    "attendanceId" INTEGER,
    "userId" INTEGER NOT NULL,
    "checkedInAt" TIMESTAMP(3) NOT NULL,
    "checkedOutAt" TIMESTAMP(3),
    "durationMinutes" INTEGER,
    "sessionDate" TIMESTAMP(3) NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendanceSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceLog" (
    "id" SERIAL NOT NULL,
    "attendanceId" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "changedById" INTEGER,
    "previousValue" JSONB,
    "newValue" JSONB,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendanceLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LegacyAttendanceData" (
    "id" SERIAL NOT NULL,
    "legacyName" TEXT NOT NULL,
    "legacyUserId" TEXT,
    "legacyStatus" TEXT NOT NULL,
    "legacyNotes" TEXT,
    "legacyEventDate" TIMESTAMP(3),
    "mappedUserId" INTEGER,
    "isMapped" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LegacyAttendanceData_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Attendance_signupId_key" ON "Attendance"("signupId");

-- CreateIndex
CREATE INDEX "Attendance_orbatId_idx" ON "Attendance"("orbatId");

-- CreateIndex
CREATE INDEX "Attendance_userId_idx" ON "Attendance"("userId");

-- CreateIndex
CREATE INDEX "Attendance_createdAt_idx" ON "Attendance"("createdAt");

-- CreateIndex
CREATE INDEX "AttendanceSession_userId_idx" ON "AttendanceSession"("userId");

-- CreateIndex
CREATE INDEX "AttendanceSession_sessionDate_idx" ON "AttendanceSession"("sessionDate");

-- CreateIndex
CREATE INDEX "AttendanceSession_attendanceId_idx" ON "AttendanceSession"("attendanceId");

-- CreateIndex
CREATE INDEX "AttendanceSession_timestamp_idx" ON "AttendanceSession"("timestamp");

-- CreateIndex
CREATE INDEX "AttendanceLog_attendanceId_idx" ON "AttendanceLog"("attendanceId");

-- CreateIndex
CREATE INDEX "AttendanceLog_changedById_idx" ON "AttendanceLog"("changedById");

-- CreateIndex
CREATE INDEX "AttendanceLog_timestamp_idx" ON "AttendanceLog"("timestamp");

-- CreateIndex
CREATE INDEX "AttendanceLog_source_idx" ON "AttendanceLog"("source");

-- CreateIndex
CREATE INDEX "LegacyAttendanceData_isMapped_idx" ON "LegacyAttendanceData"("isMapped");

-- CreateIndex
CREATE INDEX "LegacyAttendanceData_legacyUserId_idx" ON "LegacyAttendanceData"("legacyUserId");

-- CreateIndex
CREATE INDEX "LegacyAttendanceData_mappedUserId_idx" ON "LegacyAttendanceData"("mappedUserId");

-- CreateIndex
CREATE INDEX "LegacyAttendanceData_legacyEventDate_idx" ON "LegacyAttendanceData"("legacyEventDate");

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_signupId_fkey" FOREIGN KEY ("signupId") REFERENCES "Signup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_orbatId_fkey" FOREIGN KEY ("orbatId") REFERENCES "Orbat"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceSession" ADD CONSTRAINT "AttendanceSession_attendanceId_fkey" FOREIGN KEY ("attendanceId") REFERENCES "Attendance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceSession" ADD CONSTRAINT "AttendanceSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceLog" ADD CONSTRAINT "AttendanceLog_attendanceId_fkey" FOREIGN KEY ("attendanceId") REFERENCES "Attendance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceLog" ADD CONSTRAINT "AttendanceLog_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegacyAttendanceData" ADD CONSTRAINT "LegacyAttendanceData_mappedUserId_fkey" FOREIGN KEY ("mappedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
