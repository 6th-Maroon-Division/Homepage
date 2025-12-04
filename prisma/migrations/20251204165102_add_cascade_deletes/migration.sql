-- DropForeignKey
ALTER TABLE "Signup" DROP CONSTRAINT "Signup_subslotId_fkey";

-- DropForeignKey
ALTER TABLE "Slot" DROP CONSTRAINT "Slot_orbatId_fkey";

-- DropForeignKey
ALTER TABLE "Subslot" DROP CONSTRAINT "Subslot_slotId_fkey";

-- AddForeignKey
ALTER TABLE "Slot" ADD CONSTRAINT "Slot_orbatId_fkey" FOREIGN KEY ("orbatId") REFERENCES "Orbat"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subslot" ADD CONSTRAINT "Subslot_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "Slot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Signup" ADD CONSTRAINT "Signup_subslotId_fkey" FOREIGN KEY ("subslotId") REFERENCES "Subslot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
