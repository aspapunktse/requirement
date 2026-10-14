-- Withdrawing Check-ups and closing an Internal Audit (PRD 0001 F-IA.8, #158).
-- Purely additive: two nullable columns and a table; no change to any existing row, and the
-- "InternalAuditStatus" enum already has CLOSED (added with the audit in #152), so no enum change.
--
-- * "InternalAudit" gains "closedAt" / "closedById", set together with status CLOSED, like
--   "launchedAt" / "launchedById". The closing User is RESTRICT: who closed an audit is part of
--   the record.
-- * "CheckUpWithdrawal": one per Check-up at most ("checkUpId" is unique, CASCADE like the response
--   and the evaluation); its existence is what "withdrawn" means. It is final: the application
--   never updates or deletes it. The reason is required by the application (non-blank, at most
--   2000 characters). The withdrawing User is RESTRICT, like the evaluator.
-- No data migration: no audit is closed and no Check-up withdrawn before this change.

-- AlterTable
ALTER TABLE "InternalAudit" ADD COLUMN "closedAt" TIMESTAMP(3),
ADD COLUMN "closedById" TEXT;

-- CreateTable
CREATE TABLE "CheckUpWithdrawal" (
    "id" TEXT NOT NULL,
    "checkUpId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "withdrawnById" TEXT NOT NULL,
    "withdrawnAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CheckUpWithdrawal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InternalAudit_closedById_idx" ON "InternalAudit"("closedById");

-- CreateIndex
CREATE UNIQUE INDEX "CheckUpWithdrawal_checkUpId_key" ON "CheckUpWithdrawal"("checkUpId");

-- CreateIndex
CREATE INDEX "CheckUpWithdrawal_withdrawnById_idx" ON "CheckUpWithdrawal"("withdrawnById");

-- AddForeignKey
ALTER TABLE "InternalAudit" ADD CONSTRAINT "InternalAudit_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckUpWithdrawal" ADD CONSTRAINT "CheckUpWithdrawal_checkUpId_fkey" FOREIGN KEY ("checkUpId") REFERENCES "CheckUp"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckUpWithdrawal" ADD CONSTRAINT "CheckUpWithdrawal_withdrawnById_fkey" FOREIGN KEY ("withdrawnById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
