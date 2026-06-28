-- CreateTable
CREATE TABLE "LeaveOfAbsence" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "returnDate" TIMESTAMP(3),
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeaveOfAbsence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LeaveOfAbsence_userId_idx" ON "LeaveOfAbsence"("userId");

-- CreateIndex
CREATE INDEX "LeaveOfAbsence_startDate_idx" ON "LeaveOfAbsence"("startDate");

-- CreateIndex
CREATE INDEX "LeaveOfAbsence_returnDate_idx" ON "LeaveOfAbsence"("returnDate");

-- AddForeignKey
ALTER TABLE "LeaveOfAbsence" ADD CONSTRAINT "LeaveOfAbsence_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
