-- AlterTable
ALTER TABLE "ComplianceBoundary" ADD COLUMN     "retiredAt" TIMESTAMP(3),
ADD COLUMN     "retiredById" TEXT,
ADD COLUMN     "retirementComment" TEXT;

-- CreateIndex
CREATE INDEX "ComplianceBoundary_retiredById_idx" ON "ComplianceBoundary"("retiredById");

-- CreateIndex
CREATE INDEX "ComplianceBoundary_retiredAt_idx" ON "ComplianceBoundary"("retiredAt");

-- AddForeignKey
ALTER TABLE "ComplianceBoundary" ADD CONSTRAINT "ComplianceBoundary_retiredById_fkey" FOREIGN KEY ("retiredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
