-- A Check-up's evaluation (PRD 0001 F-IA.6, F-CE.1, #156).
-- Purely additive: one enum value, one enum and one table; no change to any existing
-- row or column.
--
-- * "ChangeEventAction" gains CHECK_UP_EVALUATED: a System-less Change Event written once per
--   evaluation. The value is only used by application code, never in this file, so adding it in
--   the same migration as the table is safe.
-- * "CheckUpOutcome": Conforming, Observation, Nonconformity.
-- * "CheckUpEvaluation": one per Check-up at most ("checkUpId" is unique, CASCADE like the
--   response); its existence is what "evaluated" means. It is final: the application never
--   updates it. The evaluator is RESTRICT: who judged is part of the audit evidence.

-- AlterEnum
ALTER TYPE "ChangeEventAction" ADD VALUE IF NOT EXISTS 'CHECK_UP_EVALUATED';

-- CreateEnum
CREATE TYPE "CheckUpOutcome" AS ENUM ('CONFORMING', 'OBSERVATION', 'NONCONFORMITY');

-- CreateTable
CREATE TABLE "CheckUpEvaluation" (
    "id" TEXT NOT NULL,
    "checkUpId" TEXT NOT NULL,
    "outcome" "CheckUpOutcome" NOT NULL,
    "comment" TEXT NOT NULL DEFAULT '',
    "evaluatedById" TEXT NOT NULL,
    "evaluatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CheckUpEvaluation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CheckUpEvaluation_checkUpId_key" ON "CheckUpEvaluation"("checkUpId");

-- CreateIndex
CREATE INDEX "CheckUpEvaluation_evaluatedById_idx" ON "CheckUpEvaluation"("evaluatedById");

-- AddForeignKey
ALTER TABLE "CheckUpEvaluation" ADD CONSTRAINT "CheckUpEvaluation_checkUpId_fkey" FOREIGN KEY ("checkUpId") REFERENCES "CheckUp"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckUpEvaluation" ADD CONSTRAINT "CheckUpEvaluation_evaluatedById_fkey" FOREIGN KEY ("evaluatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
