-- CreateTable
CREATE TABLE "LegacyUserData" (
    "id" SERIAL NOT NULL,
    "legacyId" TEXT NOT NULL,
    "discordUsername" TEXT NOT NULL,
    "rankName" TEXT NOT NULL,
    "dateJoined" TEXT,
    "tigSinceLastPromo" INTEGER NOT NULL,
    "totalTig" INTEGER NOT NULL,
    "oldData" INTEGER NOT NULL,
    "mappedUserId" INTEGER,
    "isMapped" BOOLEAN NOT NULL DEFAULT false,
    "isApplied" BOOLEAN NOT NULL DEFAULT false,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,

    CONSTRAINT "LegacyUserData_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LegacyUserData_discordUsername_idx" ON "LegacyUserData"("discordUsername");

-- CreateIndex
CREATE INDEX "LegacyUserData_isMapped_idx" ON "LegacyUserData"("isMapped");

-- CreateIndex
CREATE INDEX "LegacyUserData_isApplied_idx" ON "LegacyUserData"("isApplied");

-- CreateIndex
CREATE INDEX "LegacyUserData_mappedUserId_idx" ON "LegacyUserData"("mappedUserId");

-- CreateIndex
CREATE INDEX "LegacyUserData_legacyId_idx" ON "LegacyUserData"("legacyId");

-- AddForeignKey
ALTER TABLE "LegacyUserData" ADD CONSTRAINT "LegacyUserData_mappedUserId_fkey" FOREIGN KEY ("mappedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
