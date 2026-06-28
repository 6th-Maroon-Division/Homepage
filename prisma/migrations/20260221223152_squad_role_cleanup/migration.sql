/*
  Warnings:

  - You are about to drop the column `subslotId` on the `Signup` table. All the data in the column will be lost.
  - You are about to drop the column `name` on the `Slot` table. All the data in the column will be lost.
  - You are about to drop the `Subslot` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `SubslotDefinition` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[slotId,userId]` on the table `Signup` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[squadId,orderIndex]` on the table `Slot` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `slotId` to the `Signup` table without a default value. This is not possible if the table is not empty.
  - Added the required column `squadId` to the `Slot` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "Signup" DROP CONSTRAINT "Signup_subslotId_fkey";

-- DropForeignKey
ALTER TABLE "Subslot" DROP CONSTRAINT "Subslot_slotId_fkey";

-- DropForeignKey
ALTER TABLE "Subslot" DROP CONSTRAINT "Subslot_subslotDefinitionId_fkey";

-- DropForeignKey
ALTER TABLE "SubslotDefinition" DROP CONSTRAINT "SubslotDefinition_requiredRankId_fkey";

-- DropForeignKey
ALTER TABLE "SubslotDefinition" DROP CONSTRAINT "SubslotDefinition_requiredTrainingId_fkey";

-- DropIndex
DROP INDEX "Signup_subslotId_userId_key";

-- AlterTable
ALTER TABLE "Signup" DROP COLUMN "subslotId",
ADD COLUMN     "slotId" INTEGER NOT NULL;

-- AlterTable
ALTER TABLE "Slot" DROP COLUMN "name",
ADD COLUMN     "maxSignups" INTEGER DEFAULT 1,
ADD COLUMN     "squadId" INTEGER NOT NULL,
ADD COLUMN     "squadRoleId" INTEGER;

-- DropTable
DROP TABLE "Subslot";

-- DropTable
DROP TABLE "SubslotDefinition";

-- CreateTable
CREATE TABLE "SquadRole" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "description" TEXT,
    "tags" TEXT,
    "requiredTrainingIds" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "requiredRankIds" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SquadRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SquadRoleAuditLog" (
    "id" SERIAL NOT NULL,
    "squadRoleId" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "changedById" INTEGER,
    "previousValue" JSONB,
    "newValue" JSONB,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SquadRoleAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Squad" (
    "id" SERIAL NOT NULL,
    "orbatId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL,

    CONSTRAINT "Squad_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SquadRole_name_key" ON "SquadRole"("name");

-- CreateIndex
CREATE INDEX "SquadRole_category_idx" ON "SquadRole"("category");

-- CreateIndex
CREATE INDEX "SquadRoleAuditLog_squadRoleId_idx" ON "SquadRoleAuditLog"("squadRoleId");

-- CreateIndex
CREATE INDEX "SquadRoleAuditLog_changedById_idx" ON "SquadRoleAuditLog"("changedById");

-- CreateIndex
CREATE INDEX "SquadRoleAuditLog_createdAt_idx" ON "SquadRoleAuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "Squad_orbatId_idx" ON "Squad"("orbatId");

-- CreateIndex
CREATE UNIQUE INDEX "Signup_slotId_userId_key" ON "Signup"("slotId", "userId");

-- CreateIndex
CREATE INDEX "Slot_squadRoleId_idx" ON "Slot"("squadRoleId");

-- CreateIndex
CREATE INDEX "Slot_orbatId_idx" ON "Slot"("orbatId");

-- CreateIndex
CREATE UNIQUE INDEX "Slot_squadId_orderIndex_key" ON "Slot"("squadId", "orderIndex");

-- AddForeignKey
ALTER TABLE "SquadRoleAuditLog" ADD CONSTRAINT "SquadRoleAuditLog_squadRoleId_fkey" FOREIGN KEY ("squadRoleId") REFERENCES "SquadRole"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SquadRoleAuditLog" ADD CONSTRAINT "SquadRoleAuditLog_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Squad" ADD CONSTRAINT "Squad_orbatId_fkey" FOREIGN KEY ("orbatId") REFERENCES "Orbat"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Slot" ADD CONSTRAINT "Slot_squadId_fkey" FOREIGN KEY ("squadId") REFERENCES "Squad"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Slot" ADD CONSTRAINT "Slot_squadRoleId_fkey" FOREIGN KEY ("squadRoleId") REFERENCES "SquadRole"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Signup" ADD CONSTRAINT "Signup_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "Slot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
