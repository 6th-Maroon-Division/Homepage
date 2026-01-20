-- AlterTable
ALTER TABLE "Orbat" ADD COLUMN     "isMainOp" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Training" ADD COLUMN     "requiredForNewPeople" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "Rank" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "abbreviation" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "attendanceRequiredSinceLastRank" INTEGER,
    "autoRankupEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Rank_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserRank" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "currentRankId" INTEGER,
    "lastRankedUpAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attendanceSinceLastRank" INTEGER NOT NULL DEFAULT 0,
    "retired" BOOLEAN NOT NULL DEFAULT false,
    "interviewDone" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserRank_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RankHistory" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "previousRankName" TEXT,
    "newRankName" TEXT NOT NULL,
    "attendanceTotalAtChange" INTEGER NOT NULL,
    "attendanceDeltaSinceLastRank" INTEGER NOT NULL,
    "triggeredBy" VARCHAR(20) NOT NULL,
    "triggeredByUserId" INTEGER,
    "triggeredByDiscordId" TEXT,
    "outcome" VARCHAR(20),
    "declineReason" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RankHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RankTransitionRequirement" (
    "id" SERIAL NOT NULL,
    "targetRankId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RankTransitionRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingRankRequirement" (
    "id" SERIAL NOT NULL,
    "trainingId" INTEGER NOT NULL,
    "minimumRankId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrainingRankRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingTrainingRequirement" (
    "id" SERIAL NOT NULL,
    "trainingId" INTEGER NOT NULL,
    "requiredTrainingId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrainingTrainingRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromotionProposal" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "currentRankId" INTEGER NOT NULL,
    "nextRankId" INTEGER NOT NULL,
    "attendanceTotalAtProposal" INTEGER NOT NULL,
    "attendanceDeltaSinceLastRank" INTEGER NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PromotionProposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_RankTransitionRequirement" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL,

    CONSTRAINT "_RankTransitionRequirement_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "Rank_name_key" ON "Rank"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Rank_abbreviation_key" ON "Rank"("abbreviation");

-- CreateIndex
CREATE UNIQUE INDEX "UserRank_userId_key" ON "UserRank"("userId");

-- CreateIndex
CREATE INDEX "UserRank_userId_idx" ON "UserRank"("userId");

-- CreateIndex
CREATE INDEX "UserRank_currentRankId_idx" ON "UserRank"("currentRankId");

-- CreateIndex
CREATE INDEX "RankHistory_userId_idx" ON "RankHistory"("userId");

-- CreateIndex
CREATE INDEX "RankHistory_createdAt_idx" ON "RankHistory"("createdAt");

-- CreateIndex
CREATE INDEX "RankHistory_triggeredBy_idx" ON "RankHistory"("triggeredBy");

-- CreateIndex
CREATE INDEX "RankTransitionRequirement_targetRankId_idx" ON "RankTransitionRequirement"("targetRankId");

-- CreateIndex
CREATE UNIQUE INDEX "RankTransitionRequirement_targetRankId_key" ON "RankTransitionRequirement"("targetRankId");

-- CreateIndex
CREATE INDEX "TrainingRankRequirement_trainingId_idx" ON "TrainingRankRequirement"("trainingId");

-- CreateIndex
CREATE INDEX "TrainingRankRequirement_minimumRankId_idx" ON "TrainingRankRequirement"("minimumRankId");

-- CreateIndex
CREATE UNIQUE INDEX "TrainingRankRequirement_trainingId_key" ON "TrainingRankRequirement"("trainingId");

-- CreateIndex
CREATE INDEX "TrainingTrainingRequirement_trainingId_idx" ON "TrainingTrainingRequirement"("trainingId");

-- CreateIndex
CREATE INDEX "TrainingTrainingRequirement_requiredTrainingId_idx" ON "TrainingTrainingRequirement"("requiredTrainingId");

-- CreateIndex
CREATE UNIQUE INDEX "TrainingTrainingRequirement_trainingId_requiredTrainingId_key" ON "TrainingTrainingRequirement"("trainingId", "requiredTrainingId");

-- CreateIndex
CREATE INDEX "PromotionProposal_userId_idx" ON "PromotionProposal"("userId");

-- CreateIndex
CREATE INDEX "PromotionProposal_status_idx" ON "PromotionProposal"("status");

-- CreateIndex
CREATE UNIQUE INDEX "PromotionProposal_userId_nextRankId_key" ON "PromotionProposal"("userId", "nextRankId");

-- CreateIndex
CREATE INDEX "_RankTransitionRequirement_B_index" ON "_RankTransitionRequirement"("B");

-- AddForeignKey
ALTER TABLE "UserRank" ADD CONSTRAINT "UserRank_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRank" ADD CONSTRAINT "UserRank_currentRankId_fkey" FOREIGN KEY ("currentRankId") REFERENCES "Rank"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RankHistory" ADD CONSTRAINT "RankHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RankTransitionRequirement" ADD CONSTRAINT "RankTransitionRequirement_targetRankId_fkey" FOREIGN KEY ("targetRankId") REFERENCES "Rank"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingRankRequirement" ADD CONSTRAINT "TrainingRankRequirement_trainingId_fkey" FOREIGN KEY ("trainingId") REFERENCES "Training"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingRankRequirement" ADD CONSTRAINT "TrainingRankRequirement_minimumRankId_fkey" FOREIGN KEY ("minimumRankId") REFERENCES "Rank"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingTrainingRequirement" ADD CONSTRAINT "TrainingTrainingRequirement_trainingId_fkey" FOREIGN KEY ("trainingId") REFERENCES "Training"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingTrainingRequirement" ADD CONSTRAINT "TrainingTrainingRequirement_requiredTrainingId_fkey" FOREIGN KEY ("requiredTrainingId") REFERENCES "Training"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionProposal" ADD CONSTRAINT "PromotionProposal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_RankTransitionRequirement" ADD CONSTRAINT "_RankTransitionRequirement_A_fkey" FOREIGN KEY ("A") REFERENCES "RankTransitionRequirement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_RankTransitionRequirement" ADD CONSTRAINT "_RankTransitionRequirement_B_fkey" FOREIGN KEY ("B") REFERENCES "Training"("id") ON DELETE CASCADE ON UPDATE CASCADE;
