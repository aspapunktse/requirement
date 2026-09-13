-- The seed script no longer creates these placeholder requirements (they
-- predate the ISO 27001 Annex A catalog) and no other code path creates
-- Requirement rows yet, so it's safe to clear them before the new NOT NULL
-- `applicability` column is added below.
DELETE FROM "Requirement" WHERE "code" IN ('SEC-001', 'SEC-002', 'PRIV-001', 'OPS-001');

-- CreateEnum
CREATE TYPE "RequirementApplicability" AS ENUM ('ORGANIZATIONAL', 'PER_SYSTEM', 'BOTH');

-- AlterTable
ALTER TABLE "Requirement" ADD COLUMN     "applicability" "RequirementApplicability" NOT NULL,
ADD COLUMN     "examples" TEXT[],
ADD COLUMN     "intent" TEXT,
ADD COLUMN     "question" TEXT;
