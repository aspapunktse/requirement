-- Risk Analysis meetings (#325, PRD 0002 F-RA.2-3). Adds the RiskAnalysis table (with its two join tables for participants and
-- reviewed Risks), the nullable Risk.raisedInAnalysisId and the RISK_ANALYSIS_COMPLETED Change Event action. No data change and no
-- backfill; it cannot raise (it only creates new objects and adds a nullable column and an enum value nothing here uses).

-- AlterEnum
ALTER TYPE "ChangeEventAction" ADD VALUE 'RISK_ANALYSIS_COMPLETED';
-- AlterTable
ALTER TABLE "Risk" ADD COLUMN     "raisedInAnalysisId" TEXT;
-- CreateTable
CREATE TABLE "RiskAnalysis" (
    "id" TEXT NOT NULL,
    "systemId" TEXT NOT NULL,
    "heldOn" TIMESTAMP(3) NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "outsiders" TEXT[],
    "recordedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "completedById" TEXT,
    CONSTRAINT "RiskAnalysis_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "_RiskAnalysisReviewed" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,
    CONSTRAINT "_RiskAnalysisReviewed_AB_pkey" PRIMARY KEY ("A","B")
);
-- CreateTable
CREATE TABLE "_RiskAnalysisParticipants" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,
    CONSTRAINT "_RiskAnalysisParticipants_AB_pkey" PRIMARY KEY ("A","B")
);
-- CreateIndex
CREATE INDEX "RiskAnalysis_systemId_completedAt_idx" ON "RiskAnalysis"("systemId", "completedAt");
-- CreateIndex
CREATE INDEX "_RiskAnalysisReviewed_B_index" ON "_RiskAnalysisReviewed"("B");
-- CreateIndex
CREATE INDEX "_RiskAnalysisParticipants_B_index" ON "_RiskAnalysisParticipants"("B");
-- CreateIndex
CREATE INDEX "Risk_raisedInAnalysisId_idx" ON "Risk"("raisedInAnalysisId");
-- AddForeignKey
ALTER TABLE "Risk" ADD CONSTRAINT "Risk_raisedInAnalysisId_fkey" FOREIGN KEY ("raisedInAnalysisId") REFERENCES "RiskAnalysis"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "RiskAnalysis" ADD CONSTRAINT "RiskAnalysis_systemId_fkey" FOREIGN KEY ("systemId") REFERENCES "System"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "RiskAnalysis" ADD CONSTRAINT "RiskAnalysis_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "RiskAnalysis" ADD CONSTRAINT "RiskAnalysis_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "_RiskAnalysisReviewed" ADD CONSTRAINT "_RiskAnalysisReviewed_A_fkey" FOREIGN KEY ("A") REFERENCES "Risk"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "_RiskAnalysisReviewed" ADD CONSTRAINT "_RiskAnalysisReviewed_B_fkey" FOREIGN KEY ("B") REFERENCES "RiskAnalysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "_RiskAnalysisParticipants" ADD CONSTRAINT "_RiskAnalysisParticipants_A_fkey" FOREIGN KEY ("A") REFERENCES "RiskAnalysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "_RiskAnalysisParticipants" ADD CONSTRAINT "_RiskAnalysisParticipants_B_fkey" FOREIGN KEY ("B") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
