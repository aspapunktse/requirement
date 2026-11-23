-- Statement of Applicability per Compliance Boundary (#420, ADR 0016).
--
-- 1. A new table holds the exclusion justification per (Compliance Boundary, Requirement), replacing the one text per
--    Control (`Control.soaExclusionJustification`).
-- 2. A data step seeds the "ISMS scope (ISO 27001)" Boundary, holding the base Framework and every existing System, and
--    moves each Control's justification onto that Boundary's base-Framework Requirements that the Control maps to.
--    Several Controls on one Requirement: their distinct texts are combined (blank line between, sorted), so nothing is lost.
--    A justification whose Control maps to no base-Framework Requirement has no row to go to: it is appended to the Boundary's
--    description instead of being dropped.
-- 3. The old column is dropped, after the copy.
--
-- The data step selects the base Framework by its `isBase` flag (never by name or id) and the Controls by their Control
-- Mappings. It is a no-op while there is no base Framework (an empty database: nothing is created). It never raises: a name
-- clash with an existing Boundary gets a suffix, and every insert is ON CONFLICT DO NOTHING. Systems are added to the Boundary
-- in SQL, which skips the application's scope fan-out, and that is safe: the base Framework is in every System's effective
-- Framework Scope already (`isFrameworkInEffectiveScope`), so joining a Boundary that holds only the base Framework changes no
-- System's applicable Controls, Assessments or Change Reviews. Read-only pre-check: scripts/check-boundary-soa-migration.ts.
-- Ids come from gen_random_uuid() (any unique string will do; Prisma's cuid() is only its client-side default).

-- CreateTable
CREATE TABLE "BoundaryExclusionJustification" (
    "id" TEXT NOT NULL,
    "boundaryId" TEXT NOT NULL,
    "requirementId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BoundaryExclusionJustification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BoundaryExclusionJustification_requirementId_idx" ON "BoundaryExclusionJustification"("requirementId");

-- CreateIndex
CREATE INDEX "BoundaryExclusionJustification_updatedById_idx" ON "BoundaryExclusionJustification"("updatedById");

-- CreateIndex
CREATE UNIQUE INDEX "BoundaryExclusionJustification_boundaryId_requirementId_key" ON "BoundaryExclusionJustification"("boundaryId", "requirementId");

-- AddForeignKey
ALTER TABLE "BoundaryExclusionJustification" ADD CONSTRAINT "BoundaryExclusionJustification_boundaryId_fkey" FOREIGN KEY ("boundaryId") REFERENCES "ComplianceBoundary"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoundaryExclusionJustification" ADD CONSTRAINT "BoundaryExclusionJustification_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "Requirement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoundaryExclusionJustification" ADD CONSTRAINT "BoundaryExclusionJustification_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Data: the ISMS Boundary and the copied justifications.
DO $$
DECLARE
  v_base text;
  v_boundary text;
  v_name text := 'ISMS scope (ISO 27001)';
  v_orphans text;
BEGIN
  SELECT "id" INTO v_base FROM "Framework" WHERE "isBase" ORDER BY "createdAt", "id" LIMIT 1;
  IF v_base IS NULL THEN
    RETURN;
  END IF;

  -- Boundary names are unique ignoring case; an existing one with this name is left alone and ours gets a suffix.
  IF EXISTS (SELECT 1 FROM "ComplianceBoundary" WHERE lower("name") = lower(v_name)) THEN
    v_name := v_name || ' (migrated)';
  END IF;
  IF EXISTS (SELECT 1 FROM "ComplianceBoundary" WHERE lower("name") = lower(v_name)) THEN
    v_name := 'ISMS scope (ISO 27001) (migrated ' || substr(md5(random()::text), 1, 8) || ')';
  END IF;

  -- Controls with a justification but no base-Framework Requirement: nowhere to put the text, so it goes in the description.
  SELECT string_agg(c."code" || ': ' || btrim(c."soaExclusionJustification"), E'\n' ORDER BY c."code", c."id") INTO v_orphans
  FROM "Control" c
  WHERE btrim(coalesce(c."soaExclusionJustification", '')) <> ''
    AND NOT EXISTS (
      SELECT 1 FROM "ControlMapping" m JOIN "Requirement" r ON r."id" = m."requirementId"
      WHERE m."controlId" = c."id" AND r."frameworkId" = v_base
    );

  INSERT INTO "ComplianceBoundary" ("id", "name", "description", "updatedAt")
  VALUES (
    gen_random_uuid()::text,
    v_name,
    'The organization-wide ISO 27001 statement, kept as a Compliance Boundary holding every System that existed when Boundaries were introduced.'
      || CASE WHEN v_orphans IS NULL THEN '' ELSE E'\n\nExclusion justifications of Controls that map to no ISO 27001 Requirement, kept from before:\n' || v_orphans END,
    CURRENT_TIMESTAMP
  )
  ON CONFLICT DO NOTHING
  RETURNING "id" INTO v_boundary;
  IF v_boundary IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO "ComplianceBoundaryFramework" ("id", "boundaryId", "frameworkId")
  VALUES (gen_random_uuid()::text, v_boundary, v_base)
  ON CONFLICT DO NOTHING;

  INSERT INTO "ComplianceBoundarySystem" ("id", "boundaryId", "systemId")
  SELECT gen_random_uuid()::text, v_boundary, s."id" FROM "System" s
  ON CONFLICT DO NOTHING;

  INSERT INTO "BoundaryExclusionJustification" ("id", "boundaryId", "requirementId", "text", "updatedAt")
  SELECT gen_random_uuid()::text, v_boundary, t."requirementId", string_agg(t."text", E'\n\n' ORDER BY t."text"), CURRENT_TIMESTAMP
  FROM (
    SELECT DISTINCT m."requirementId", btrim(c."soaExclusionJustification") AS "text"
    FROM "Control" c
    JOIN "ControlMapping" m ON m."controlId" = c."id"
    JOIN "Requirement" r ON r."id" = m."requirementId"
    WHERE r."frameworkId" = v_base AND btrim(coalesce(c."soaExclusionJustification", '')) <> ''
  ) t
  GROUP BY t."requirementId"
  ON CONFLICT ("boundaryId", "requirementId") DO NOTHING;
END $$;

-- AlterTable: the values are copied above.
ALTER TABLE "Control" DROP COLUMN "soaExclusionJustification";
