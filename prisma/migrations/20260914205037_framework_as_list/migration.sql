-- Requirement.framework: single nullable string -> non-nullable string list
-- (see #52 / ADR 0003 "author once, tag many"). Hand-written instead of a
-- Prisma auto-diff drop+recreate, to preserve existing values: a non-null
-- string becomes a one-element array, null becomes an empty array.
ALTER TABLE "Requirement"
  ALTER COLUMN "framework" TYPE TEXT[]
  USING (CASE WHEN "framework" IS NULL THEN ARRAY[]::TEXT[] ELSE ARRAY["framework"] END);

ALTER TABLE "Requirement"
  ALTER COLUMN "framework" SET DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "Requirement"
  ALTER COLUMN "framework" SET NOT NULL;
