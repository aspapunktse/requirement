-- AlterEnum
-- Change Event for "a Compliance Manager or an Admin added, changed or cleared the exclusion
-- justification of a Control on the Statement of Applicability" (#150). System-less. No data change.
ALTER TYPE "ChangeEventAction" ADD VALUE IF NOT EXISTS 'SOA_JUSTIFICATION_CHANGED';

-- AlterTable
-- The exclusion justification text; null for every existing Control. No data change.
ALTER TABLE "Control" ADD COLUMN "soaExclusionJustification" TEXT;
