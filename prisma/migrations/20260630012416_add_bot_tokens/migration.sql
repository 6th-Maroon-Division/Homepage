-- CreateTable
CREATE TABLE "AttendanceEvent" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "isJoin" BOOLEAN NOT NULL,
    "eventTime" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttendanceEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BotToken" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "createdById" INTEGER,

    CONSTRAINT "BotToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AttendanceEvent_userId_idx" ON "AttendanceEvent"("userId");

-- CreateIndex
CREATE INDEX "AttendanceEvent_eventTime_idx" ON "AttendanceEvent"("eventTime");

-- CreateIndex
CREATE UNIQUE INDEX "BotToken_token_key" ON "BotToken"("token");

-- CreateIndex
CREATE INDEX "BotToken_token_idx" ON "BotToken"("token");

-- CreateIndex
CREATE INDEX "BotToken_isActive_idx" ON "BotToken"("isActive");

-- AddForeignKey
ALTER TABLE "AttendanceEvent" ADD CONSTRAINT "AttendanceEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BotToken" ADD CONSTRAINT "BotToken_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
