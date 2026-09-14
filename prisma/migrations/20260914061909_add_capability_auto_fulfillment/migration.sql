-- AlterTable
ALTER TABLE "RequirementAssessment" ADD COLUMN     "fulfilledByCapabilityId" TEXT;

-- AddForeignKey
ALTER TABLE "RequirementAssessment" ADD CONSTRAINT "RequirementAssessment_fulfilledByCapabilityId_fkey" FOREIGN KEY ("fulfilledByCapabilityId") REFERENCES "Capability"("id") ON DELETE SET NULL ON UPDATE CASCADE;
