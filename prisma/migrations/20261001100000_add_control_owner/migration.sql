-- AlterTable
-- The Control Owner (F-CL.3, #119): one optional User per Control. Nullable, so every existing
-- Control stays unassigned (PRD 0001 §9.7); no data is touched.
ALTER TABLE "Control" ADD COLUMN "ownerId" TEXT;

-- CreateIndex
CREATE INDEX "Control_ownerId_idx" ON "Control"("ownerId");

-- AddForeignKey
-- SET NULL: deleting a User who owns Controls leaves those Controls unassigned.
ALTER TABLE "Control" ADD CONSTRAINT "Control_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
