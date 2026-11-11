-- The Risk Analysis lead of a System (#361): the one person given the "Conduct the Risk Analysis" task on Home.
-- 1. System.riskAnalysisLeadId: nullable, so every existing System has no lead (no data change). ON DELETE SET NULL, as for the
--    Business System Owner: deleting the User leaves the System without a lead.
-- 2. The Change Event action for naming, changing or clearing it. A new enum value can't be used in the migration that adds it, and
--    nothing here uses it.

-- AlterEnum
ALTER TYPE "ChangeEventAction" ADD VALUE 'RISK_ANALYSIS_LEAD_CHANGED';

-- AlterTable
ALTER TABLE "System" ADD COLUMN "riskAnalysisLeadId" TEXT;

-- CreateIndex
CREATE INDEX "System_riskAnalysisLeadId_idx" ON "System"("riskAnalysisLeadId");

-- AddForeignKey
ALTER TABLE "System" ADD CONSTRAINT "System_riskAnalysisLeadId_fkey" FOREIGN KEY ("riskAnalysisLeadId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
