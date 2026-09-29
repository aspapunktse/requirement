-- Framework-owned Requirements + Control Mappings (ADR 0005, PRD 0001 §9
-- steps 2-3, #72). Hand-written because data moves: the old
-- Control.frameworks tag (join table "_ControlToFramework": A = Control id,
-- B = Framework id) becomes Requirements + FULL Control Mappings for the ISO
-- base Framework, and is dropped for every other Framework.
--
-- Order matters: create the new schema, backfill from the join table, then
-- drop the join table. Nothing here hard-codes an id; the ISO row is selected
-- by id (see below) and Requirements are generated from whatever the join table
-- holds for it, so this works for 0..n other Frameworks. Ids for new rows
-- come from gen_random_uuid() (any unique string will do; Prisma's cuid()
-- default is client-side only).

-- CreateEnum
CREATE TYPE "FrameworkLicensing" AS ENUM ('PARAPHRASE_ONLY', 'QUOTABLE');

-- CreateEnum
CREATE TYPE "FrameworkStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "ControlCoverage" AS ENUM ('FULL', 'PARTIAL');

-- AlterEnum (System-less Change Events, F-CE.1; nothing emits them yet)
ALTER TYPE "ChangeEventAction" ADD VALUE 'CONTROL_MAPPING_CHANGED';
ALTER TYPE "ChangeEventAction" ADD VALUE 'FRAMEWORK_PUBLISHED';

-- AlterTable: a Change Event can now be System-less
ALTER TABLE "ChangeEvent" ALTER COLUMN "systemId" DROP NOT NULL;

-- AlterTable: Supplementary Controls record their origin Framework
ALTER TABLE "Control" ADD COLUMN "originFrameworkId" TEXT;

-- DropIndex: name alone is no longer unique, name + version is
DROP INDEX "Framework_name_key";

-- AlterTable: Framework metadata. Existing rows get version '1' as a
-- placeholder (the ISO row is set to '2022' below); the default is dropped
-- again afterwards so new Frameworks must state a version.
ALTER TABLE "Framework"
ADD COLUMN "isBase" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "licensing" "FrameworkLicensing" NOT NULL DEFAULT 'PARAPHRASE_ONLY',
ADD COLUMN "status" "FrameworkStatus" NOT NULL DEFAULT 'DRAFT',
ADD COLUMN "supersedesId" TEXT,
ADD COLUMN "version" TEXT NOT NULL DEFAULT '1';

-- CreateTable
CREATE TABLE "Requirement" (
    "id" TEXT NOT NULL,
    "frameworkId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Requirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ControlMapping" (
    "id" TEXT NOT NULL,
    "requirementId" TEXT NOT NULL,
    "controlId" TEXT NOT NULL,
    "coverage" "ControlCoverage" NOT NULL,
    "rationale" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ControlMapping_pkey" PRIMARY KEY ("id")
);

-- Data: pick the ISO 27001:2022 Framework row, which becomes the base
-- Framework. Framework names are editable in the admin UI, so the row is
-- selected by id, not assumed to still carry its seeded name:
--   (a) the row named exactly 'ISO27001:2022 Annex A' (what the seed
--       creates), else
--   (b) the Framework tagging the most Controls whose code is 'A.%' (Annex A
--       codes) in "_ControlToFramework" ("B" = Framework id), ties broken by
--       lowest id.
-- If neither exists (empty or fresh database) nothing is selected and nothing
-- is updated; the seed then creates the base Framework itself.
CREATE TEMPORARY TABLE "_iso_base_framework" AS
SELECT COALESCE(
  (SELECT "id" FROM "Framework" WHERE "name" = 'ISO27001:2022 Annex A'),
  (
    SELECT t."B"
    FROM "_ControlToFramework" t
    JOIN "Control" c ON c."id" = t."A"
    WHERE c."code" LIKE 'A.%'
    GROUP BY t."B"
    ORDER BY count(*) DESC, t."B"
    LIMIT 1
  )
) AS "id";

-- Guard against a name + version collision: if some *other* row is already
-- called 'ISO/IEC 27001' at version '2022', the rename below would violate
-- the new unique index. Move that row's version out of the way first. (Every
-- pre-existing row currently carries the placeholder version '1', so this is
-- purely defensive.)
UPDATE "Framework"
SET "version" = '2022-dup-' || "id"
WHERE "name" = 'ISO/IEC 27001'
  AND "version" = '2022'
  AND "id" <> (SELECT "id" FROM "_iso_base_framework" WHERE "id" IS NOT NULL);

-- The selected row (same id, so Framework Scope and Business Risk Owner
-- portfolio assignments are preserved) becomes the base Framework,
-- Published, paraphrase-only, version 2022. Every other Framework row stays
-- a Draft (the column default) with its old tags dropped below; they are
-- re-authored in a later milestone. Their existing Framework Scope rows stay.
UPDATE "Framework"
SET "name" = 'ISO/IEC 27001',
    "version" = '2022',
    "isBase" = true,
    "status" = 'PUBLISHED',
    "licensing" = 'PARAPHRASE_ONLY'
WHERE "id" = (SELECT "id" FROM "_iso_base_framework");

DROP TABLE "_iso_base_framework";

-- Data: one Requirement per Control tagged with the base Framework. code =
-- the Control's code (the Annex A code), section = its category, title/text
-- = its title/description paraphrase. Untagged Controls get nothing.
INSERT INTO "Requirement" ("id", "frameworkId", "code", "section", "title", "text", "updatedAt")
SELECT gen_random_uuid()::text, f."id", c."code", c."category", c."title", c."description", CURRENT_TIMESTAMP
FROM "_ControlToFramework" t
JOIN "Control" c ON c."id" = t."A"
JOIN "Framework" f ON f."id" = t."B"
WHERE f."isBase";

-- Data: each generated Requirement is mapped FULL, 1:1, to the Control it
-- was generated from (same code).
INSERT INTO "ControlMapping" ("id", "requirementId", "controlId", "coverage", "updatedAt")
SELECT gen_random_uuid()::text, r."id", c."id", 'FULL', CURRENT_TIMESTAMP
FROM "Requirement" r
JOIN "Framework" f ON f."id" = r."frameworkId" AND f."isBase"
JOIN "Control" c ON c."code" = r."code";

-- Old tags are gone: the ISO ones are now mappings, the rest are dropped.
DROP TABLE "_ControlToFramework";

ALTER TABLE "Framework" ALTER COLUMN "version" DROP DEFAULT;

-- CreateIndex
CREATE UNIQUE INDEX "Framework_name_version_key" ON "Framework"("name", "version");

-- CreateIndex
CREATE UNIQUE INDEX "Requirement_frameworkId_code_key" ON "Requirement"("frameworkId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "ControlMapping_requirementId_controlId_key" ON "ControlMapping"("requirementId", "controlId");

-- CreateIndex
CREATE INDEX "ControlMapping_controlId_idx" ON "ControlMapping"("controlId");

-- AddForeignKey
ALTER TABLE "Framework" ADD CONSTRAINT "Framework_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "Framework"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Requirement" ADD CONSTRAINT "Requirement_frameworkId_fkey" FOREIGN KEY ("frameworkId") REFERENCES "Framework"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ControlMapping" ADD CONSTRAINT "ControlMapping_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "Requirement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ControlMapping" ADD CONSTRAINT "ControlMapping_controlId_fkey" FOREIGN KEY ("controlId") REFERENCES "Control"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Control" ADD CONSTRAINT "Control_originFrameworkId_fkey" FOREIGN KEY ("originFrameworkId") REFERENCES "Framework"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
