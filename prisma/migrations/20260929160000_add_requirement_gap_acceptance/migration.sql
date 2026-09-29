-- AlterTable
ALTER TABLE "Requirement" ADD COLUMN     "gapAcceptedAt" TIMESTAMP(3),
ADD COLUMN     "gapAcceptedById" TEXT,
ADD COLUMN     "gapJustification" TEXT;

-- AddForeignKey
ALTER TABLE "Requirement" ADD CONSTRAINT "Requirement_gapAcceptedById_fkey" FOREIGN KEY ("gapAcceptedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
