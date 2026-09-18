-- CreateTable
CREATE TABLE "SteamLoginAttempt" (
    "stateHash" TEXT NOT NULL,
    "userId" INTEGER,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SteamLoginAttempt_pkey" PRIMARY KEY ("stateHash")
);

-- CreateIndex
CREATE INDEX "SteamLoginAttempt_expiresAt_idx" ON "SteamLoginAttempt"("expiresAt");
