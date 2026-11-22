-- Guidance notes (#405): an optional note on an Audit Question, a draft question and a Check-up question, copied along with
-- the question (bank -> draft -> Check-up). Three nullable columns, no data migration (existing questions have no note),
-- a no-op on an empty database.

-- AlterTable
ALTER TABLE "ControlAuditQuestion" ADD COLUMN "guidance" TEXT;

-- AlterTable
ALTER TABLE "InternalAuditQuestion" ADD COLUMN "guidance" TEXT;

-- AlterTable
ALTER TABLE "CheckUpQuestion" ADD COLUMN "guidance" TEXT;
