-- #55: add BUSINESS_RISK_OWNER role, Business Unit catalog, and promote
-- Requirement.framework from a free-text String[] tag to a first-class
-- Framework catalog entity (adds strictComplianceRequired and a new
-- System-side "Framework Scope" relation). Hand-written instead of a Prisma
-- auto-diff drop+recreate, to preserve existing framework tag data — see
-- the backfill block below and ADR 0004
-- (docs/adr/0004-framework-as-first-class-entity.md).

-- AlterEnum
-- Safe to run inside the same transaction as the rest of this migration:
-- the new value isn't referenced by any statement below.
ALTER TYPE "UserRole" ADD VALUE 'BUSINESS_RISK_OWNER';

-- CreateTable
CREATE TABLE "BusinessUnit" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BusinessUnit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BusinessUnit_name_key" ON "BusinessUnit"("name");

-- CreateTable
CREATE TABLE "Framework" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "strictComplianceRequired" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Framework_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Framework_name_key" ON "Framework"("name");

-- CreateTable
CREATE TABLE "_FrameworkToRequirement" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_FrameworkToRequirement_AB_pkey" PRIMARY KEY ("A","B")
);

CREATE INDEX "_FrameworkToRequirement_B_index" ON "_FrameworkToRequirement"("B");

-- Backfill: one Framework row per distinct existing Requirement.framework
-- tag value, preserving #52's "author once, tag many" data as real FK rows
-- instead of free text. Today only "ISO27001:2022 Annex A" exists in the
-- seeded catalog, but this backfills generically from whatever's actually
-- in the column rather than assuming that. gen_random_uuid() (built in
-- since PG13) stands in for Prisma's client-side cuid() default, which only
-- applies to ORM-issued inserts, not this hand-written backfill — nothing
-- else depends on the id format.
INSERT INTO "Framework" ("id", "name")
SELECT gen_random_uuid()::text, tag
FROM (SELECT DISTINCT unnest("framework") AS tag FROM "Requirement") AS tags
WHERE tag IS NOT NULL;

INSERT INTO "_FrameworkToRequirement" ("A", "B")
SELECT f."id", r."id"
FROM "Requirement" r
CROSS JOIN LATERAL unnest(r."framework") AS tag
JOIN "Framework" f ON f."name" = tag;

ALTER TABLE "_FrameworkToRequirement"
  ADD CONSTRAINT "_FrameworkToRequirement_A_fkey" FOREIGN KEY ("A") REFERENCES "Framework"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "_FrameworkToRequirement"
  ADD CONSTRAINT "_FrameworkToRequirement_B_fkey" FOREIGN KEY ("B") REFERENCES "Requirement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
-- The free-text tag column is now fully represented by _FrameworkToRequirement.
ALTER TABLE "Requirement" DROP COLUMN "framework";

-- CreateTable (new relations — no existing data to preserve)
CREATE TABLE "_BusinessUnitToSystem" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_BusinessUnitToSystem_AB_pkey" PRIMARY KEY ("A","B")
);

CREATE INDEX "_BusinessUnitToSystem_B_index" ON "_BusinessUnitToSystem"("B");

-- CreateTable
CREATE TABLE "_BusinessUnitToUser" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_BusinessUnitToUser_AB_pkey" PRIMARY KEY ("A","B")
);

CREATE INDEX "_BusinessUnitToUser_B_index" ON "_BusinessUnitToUser"("B");

-- CreateTable
CREATE TABLE "_SystemFrameworkScope" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_SystemFrameworkScope_AB_pkey" PRIMARY KEY ("A","B")
);

CREATE INDEX "_SystemFrameworkScope_B_index" ON "_SystemFrameworkScope"("B");

-- CreateTable
CREATE TABLE "_FrameworkRiskOwner" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_FrameworkRiskOwner_AB_pkey" PRIMARY KEY ("A","B")
);

CREATE INDEX "_FrameworkRiskOwner_B_index" ON "_FrameworkRiskOwner"("B");

-- AddForeignKey
ALTER TABLE "_BusinessUnitToSystem" ADD CONSTRAINT "_BusinessUnitToSystem_A_fkey" FOREIGN KEY ("A") REFERENCES "BusinessUnit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "_BusinessUnitToSystem" ADD CONSTRAINT "_BusinessUnitToSystem_B_fkey" FOREIGN KEY ("B") REFERENCES "System"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_BusinessUnitToUser" ADD CONSTRAINT "_BusinessUnitToUser_A_fkey" FOREIGN KEY ("A") REFERENCES "BusinessUnit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "_BusinessUnitToUser" ADD CONSTRAINT "_BusinessUnitToUser_B_fkey" FOREIGN KEY ("B") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_SystemFrameworkScope" ADD CONSTRAINT "_SystemFrameworkScope_A_fkey" FOREIGN KEY ("A") REFERENCES "Framework"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "_SystemFrameworkScope" ADD CONSTRAINT "_SystemFrameworkScope_B_fkey" FOREIGN KEY ("B") REFERENCES "System"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_FrameworkRiskOwner" ADD CONSTRAINT "_FrameworkRiskOwner_A_fkey" FOREIGN KEY ("A") REFERENCES "Framework"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "_FrameworkRiskOwner" ADD CONSTRAINT "_FrameworkRiskOwner_B_fkey" FOREIGN KEY ("B") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
