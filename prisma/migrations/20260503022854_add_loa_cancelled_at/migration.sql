-- AlterTable
ALTER TABLE "LeaveOfAbsence" ADD COLUMN     "cancelledAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "LeaveOfAbsence_cancelledAt_idx" ON "LeaveOfAbsence"("cancelledAt");
