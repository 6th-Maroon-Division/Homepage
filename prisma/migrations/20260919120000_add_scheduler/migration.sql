CREATE TABLE "SchedulerState" (
    "id" TEXT NOT NULL,
    "activatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SchedulerState_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "SchedulerJob" (
    "key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "userId" INTEGER,
    "expectedRankId" INTEGER,
    "orbatId" INTEGER,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SchedulerJob_pkey" PRIMARY KEY ("key")
);
CREATE INDEX "SchedulerJob_completedAt_nextAttemptAt_idx" ON "SchedulerJob"("completedAt", "nextAttemptAt");
