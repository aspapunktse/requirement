-- OG3, the Business System Owner's decision (#330): the GateDecision table (one row per decision at a gate), its outcome enum, the
-- "closed" marker on System (set by a Reject, which is final), and the GATE_DECIDED Change Event action. Additive only: one nullable
-- column, one new table, one new enum value that no SQL here uses. No data changes, and it cannot raise.

-- CreateEnum
CREATE TYPE "GateOutcome" AS ENUM ('AUTHORIZE', 'REJECT', 'SEND_BACK');

-- AlterEnum
ALTER TYPE "ChangeEventAction" ADD VALUE 'GATE_DECIDED';

-- AlterTable
ALTER TABLE "System" ADD COLUMN "evaluationClosedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "GateDecision" (
    "id" TEXT NOT NULL,
    "systemId" TEXT NOT NULL,
    "gate" "EvaluationStage" NOT NULL,
    "outcome" "GateOutcome" NOT NULL,
    "sentBackTo" "EvaluationStage",
    "comment" TEXT NOT NULL,
    "decidedById" TEXT NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GateDecision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GateDecision_systemId_idx" ON "GateDecision"("systemId");

-- AddForeignKey
ALTER TABLE "GateDecision" ADD CONSTRAINT "GateDecision_systemId_fkey" FOREIGN KEY ("systemId") REFERENCES "System"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GateDecision" ADD CONSTRAINT "GateDecision_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
