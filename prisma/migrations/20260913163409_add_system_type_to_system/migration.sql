/*
  Warnings:

  - Added the required column `systemTypeId` to the `System` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "System" ADD COLUMN     "systemTypeId" TEXT NOT NULL;

-- AddForeignKey
ALTER TABLE "System" ADD CONSTRAINT "System_systemTypeId_fkey" FOREIGN KEY ("systemTypeId") REFERENCES "SystemType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
