-- DropForeignKey
ALTER TABLE "Signup" DROP CONSTRAINT "Signup_userId_fkey";

-- AddForeignKey
ALTER TABLE "Signup" ADD CONSTRAINT "Signup_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
