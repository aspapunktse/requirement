-- Comparison outcome (#375): a Comparison is closed when its outcome is recorded. Four nullable columns, all null while it is open.
-- Structure only: no rows are read, copied or changed, so it is a no-op on an empty database and every existing Comparison stays open.
--   outcomeRecordedAt   set = closed; when the outcome was recorded.
--   outcomeRecordedById who recorded it; SetNull: deleting that User keeps the Comparison closed.
--   outcomeComment      the required comment.
--   outcomeSnapshot     JSON: the chosen Candidate (or none) and each Candidate's figures frozen at that moment (validated with zod when read).

-- AlterTable
ALTER TABLE "Comparison" ADD COLUMN     "outcomeComment" TEXT,
ADD COLUMN     "outcomeRecordedAt" TIMESTAMP(3),
ADD COLUMN     "outcomeRecordedById" TEXT,
ADD COLUMN     "outcomeSnapshot" JSONB;

-- CreateIndex
CREATE INDEX "Comparison_outcomeRecordedById_idx" ON "Comparison"("outcomeRecordedById");

-- AddForeignKey
ALTER TABLE "Comparison" ADD CONSTRAINT "Comparison_outcomeRecordedById_fkey" FOREIGN KEY ("outcomeRecordedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
