-- Risk Source (#322, PRD 0002 F-RA.1): where a Risk came from.
--
-- Backfill rule, from the Risk's existing links: a Check-up link (a Nonconformity opened it) is an
-- audit finding; else an Assessment link (a "No" Self-Assessment answer opened it) is a requirement
-- non-conformance; anything else is ad hoc. If a row ever had both links, the Check-up wins (no row
-- does today; the Check-up is the later, more specific origin).
--
-- Cannot abort: a new enum type, a column added with a constant default (so existing rows are filled
-- and the NOT NULL holds on any table, empty or not), then one UPDATE that only assigns enum values.
-- Idempotent in effect: the UPDATE recomputes the same value from the links. A no-op on an empty database. The default stays, as in schema.prisma.

CREATE TYPE "RiskSource" AS ENUM ('REQUIREMENT_NONCONFORMANCE', 'AUDIT_FINDING', 'AD_HOC');

ALTER TABLE "Risk" ADD COLUMN "source" "RiskSource" NOT NULL DEFAULT 'AD_HOC';

UPDATE "Risk"
SET "source" = CASE
  WHEN "checkUpId" IS NOT NULL THEN 'AUDIT_FINDING'::"RiskSource"
  WHEN "controlAssessmentId" IS NOT NULL THEN 'REQUIREMENT_NONCONFORMANCE'::"RiskSource"
  ELSE 'AD_HOC'::"RiskSource"
END;
