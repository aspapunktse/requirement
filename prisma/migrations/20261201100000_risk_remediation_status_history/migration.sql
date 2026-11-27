-- Risk remediation and status history (#456, ADR 0019): a nullable deadline on Risk, remediation milestones, and an append-only
-- status history for Risks and Control Assessments. Only adds: one nullable column, two tables, one enum. No existing row changes,
-- no backfill (the past is unknown), and it is a no-op on an empty database.

-- CreateEnum
CREATE TYPE "StatusChangeSubject" AS ENUM ('RISK', 'CONTROL_ASSESSMENT');

-- AlterTable
ALTER TABLE "Risk" ADD COLUMN     "deadline" DATE;

-- CreateTable
CREATE TABLE "RiskMilestone" (
    "id" TEXT NOT NULL,
    "riskId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "plannedDate" DATE NOT NULL,
    "completedDate" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RiskMilestone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StatusChange" (
    "id" TEXT NOT NULL,
    "systemId" TEXT,
    "subjectType" "StatusChangeSubject" NOT NULL,
    "subjectId" TEXT NOT NULL,
    "controlId" TEXT,
    "fromStatus" TEXT,
    "toStatus" TEXT NOT NULL,
    "actorId" TEXT,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StatusChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RiskMilestone_riskId_idx" ON "RiskMilestone"("riskId");

-- CreateIndex
CREATE INDEX "StatusChange_subjectType_subjectId_changedAt_idx" ON "StatusChange"("subjectType", "subjectId", "changedAt");

-- CreateIndex
CREATE INDEX "StatusChange_systemId_subjectType_idx" ON "StatusChange"("systemId", "subjectType");

-- AddForeignKey
ALTER TABLE "RiskMilestone" ADD CONSTRAINT "RiskMilestone_riskId_fkey" FOREIGN KEY ("riskId") REFERENCES "Risk"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatusChange" ADD CONSTRAINT "StatusChange_systemId_fkey" FOREIGN KEY ("systemId") REFERENCES "System"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatusChange" ADD CONSTRAINT "StatusChange_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
