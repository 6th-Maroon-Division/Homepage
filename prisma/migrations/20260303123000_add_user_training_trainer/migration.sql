ALTER TABLE "UserTraining"
ADD COLUMN "trainerId" INTEGER;

ALTER TABLE "UserTraining"
ADD CONSTRAINT "UserTraining_trainerId_fkey"
FOREIGN KEY ("trainerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "UserTraining_trainerId_idx" ON "UserTraining"("trainerId");
