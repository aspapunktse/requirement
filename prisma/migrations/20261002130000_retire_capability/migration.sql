-- Retire Capability (ADR 0008, PRD 0001 F-IN.8 and migration section 9.5, #126).
--
-- Each Capability becomes a Provider System, every System that declared it depends on that Provider,
-- and then the Capability tables are dropped.
--
-- Join-table column semantics (Prisma orders the sides alphabetically by model):
--   "_CapabilityToControl":      A = Capability id,      B = Control id
--   "_CapabilityToSystem":       A = Capability id,      B = System id
--   "_DeploymentFacetToSystem":  A = DeploymentFacet id, B = System id
--   "_ControlToDeploymentFacet": A = Control id,         B = DeploymentFacet id
--   "_SystemFrameworkScope":     A = Framework id,       B = System id
--
-- THE INVARIANT: no existing System's effective status for any Control goes DOWN or otherwise
-- changes because of this migration. (The one deliberate change is an improvement: an untouched Not
-- Started Assessment of a Control a declared Capability covered becomes effectively Fulfilled through
-- the Provider, which is what #116 asked for.) The case analysis, per Capability:
--
--   1. The Provider System. Created ONBOARDED (onboardedAt = the migration time), isProvider true,
--      named like the Capability, described as migrated from it, owned by the earliest-created Admin
--      (ties by id). No other System field is set. A System with the same name may already exist
--      (names are not unique); the Provider is created anyway (scripts/check-capability-migration.ts
--      reports the collision). No Approval row is written.
--   2. Its classification (product-owner decision of 2026-10-02) is the UNION of the Systems that
--      declared the Capability: all their Deployment Facets, all their declared Framework Scopes, and
--      on each Impact Level axis the highest level any of them has (unclassified where every one of
--      them is). So every Control that applies to a declaring System also applies to the Provider.
--      A Capability no System declared gets no Facets, no Framework Scope and unclassified levels.
--      (The converse does not hold: a Control can apply to the Provider that applies to no single
--      declaring System, e.g. scoped to a Facet of one System and to a threshold only another meets.
--      It gets an Assessment row and, if the Capability mapped it, an Offering; no dependent is
--      affected, since the Control does not apply to them. The pre-check script lists those.)
--   3. Assessments. The Provider gets a Control Assessment for every Control that applies to it
--      (the rule of controlAppliesToSystem, written out in SQL below): Fulfilled with the note
--      'migrated from Capability "<name>" — verify' for a Control the Capability mapped, Not Started
--      for the rest. assessedById is NULL on all of them: the migration is not a person, and an
--      Assessment nobody set is what Capability auto-fulfilment produced before (an Admin's name on a
--      row nobody assessed would be a false record). The status itself is what dependents read, whoever
--      set it. The accepted consequence: the Provider's other Controls start Not Started, so it shows
--      in its Admin owner's tasks and lowers the pooled Compliance Percentage until it is assessed.
--   4. Offerings. Each Control the Capability mapped that APPLIES TO THE PROVIDER becomes a Full
--      Offering. An Organizational Control, or one that applies to no declaring System (and so not
--      to the Provider), gets none (product-owner decision of 2026-10-02): it has no Assessment to
--      back it, or the Provider could not offer it. The pre-check script lists them.
--   5. Dependencies. Each System that declared the Capability depends on the Provider, whatever its
--      status (ProviderDependency).
--   6. Auto-fulfilled Assessments (fulfilledByCapabilityId set) go back to the System's untouched
--      Not Started (the values of UNTOUCHED_ASSESSMENT_DATA), so the Provider's Full Offering makes
--      them effectively Fulfilled, but ONLY where that is certain to hold: nobody has touched the row
--      (assessedById null, Fulfilled, no evidence, no Self-Assessment answer, no note but
--      'Inherited via ...'), the System declared that Capability, the Control is one it mapped, the
--      Control applies to the System and to the Provider (so an Offering exists), and the System is
--      not itself a Provider offering that Control (its dependents read its STORED status, which
--      would drop). Any other such row is LEFT AS IT IS (Fulfilled, nobody set, so effectively
--      Fulfilled by itself): resetting it could lower an effective status, and the migration neither
--      lowers one nor invents a fallback. The pre-check script lists those rows.
--   7. One "system" Change Event (CLASSIFICATION_CHANGED) on each System that declared a Capability:
--      Capability "X" migrated to a dependency on Provider "X". Nothing else writes events.
--   8. Then fulfilledByCapabilityId, both join tables and Capability are dropped.
--
-- ABORTS (RAISE EXCEPTION, nothing changed): Capabilities exist and there is no Admin to own the
-- Providers. Prisma then records the migration as failed and every later `migrate deploy` refuses to
-- run until it is resolved: create an Admin (or promote a User), run
--   npx prisma migrate resolve --rolled-back 20261002130000_retire_capability
-- and deploy again. Run scripts/check-capability-migration.ts (read-only; exits 1 when the migration
-- would abort) against the target database BEFORE deploying.
--
-- Data-driven (no ids or display names hard-coded), a no-op apart from the drops on a database with no
-- Capabilities, and safe to re-run (guarded by the table's existence; every INSERT that can collide is
-- ON CONFLICT DO NOTHING). Ids come from gen_random_uuid() (any unique string will do; Prisma's cuid()
-- default is client-side only). Prisma runs the whole file as one transaction, so an abort leaves
-- nothing behind. updatedAt has no database default, so every written row sets it.

DO $$
DECLARE
  v_admin_id text;
  v_now timestamp(3) := timezone('UTC', now());
  v_capabilities int;
  v_providers int;
  v_offerings int;
  v_dependencies int;
  v_reset int;
  v_kept int;
  v_dropped int;
BEGIN
  IF to_regclass('"Capability"') IS NULL THEN
    RETURN; -- already migrated, nothing to do
  END IF;

  SELECT count(*) INTO v_capabilities FROM "Capability";
  IF v_capabilities = 0 THEN
    RETURN; -- an empty database (or one without Capabilities): only the drops below
  END IF;

  SELECT u."id" INTO v_admin_id FROM "User" u WHERE u."role" = 'ADMIN' ORDER BY u."createdAt", u."id" LIMIT 1;
  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'Cannot retire Capability: % Capability(ies) exist and each becomes a Provider System owned by an Admin, but there is no Admin. Create an Admin (or promote a User), run "prisma migrate resolve --rolled-back 20261002130000_retire_capability" and deploy again. See scripts/check-capability-migration.ts.', v_capabilities;
  END IF;

  -- One row per Capability: the new Provider's id and its classification (the union of its declaring Systems).
  CREATE TEMP TABLE cap_plan ON COMMIT DROP AS
  SELECT c."id" AS capability_id,
         c."name" AS name,
         c."description" AS description,
         gen_random_uuid()::text AS provider_id,
         (SELECT max(s."confidentialityImpactLevel") FROM "_CapabilityToSystem" cs JOIN "System" s ON s."id" = cs."B" WHERE cs."A" = c."id") AS conf,
         (SELECT max(s."integrityImpactLevel") FROM "_CapabilityToSystem" cs JOIN "System" s ON s."id" = cs."B" WHERE cs."A" = c."id") AS integ,
         (SELECT max(s."availabilityImpactLevel") FROM "_CapabilityToSystem" cs JOIN "System" s ON s."id" = cs."B" WHERE cs."A" = c."id") AS avail
  FROM "Capability" c;

  INSERT INTO "System" ("id", "name", "vendor", "description", "status", "ownerId", "createdAt", "updatedAt", "onboardedAt",
                        "confidentialityImpactLevel", "integrityImpactLevel", "availabilityImpactLevel", "isProvider")
  SELECT p.provider_id, p.name, NULL,
         CASE WHEN p.description IS NULL OR btrim(p.description) = '' THEN '' ELSE p.description || E'\n\n' END
           || 'Migrated from the retired Capability "' || p.name || '".',
         'ONBOARDED', v_admin_id, v_now, v_now, v_now,
         p.conf, p.integ, p.avail, true
  FROM cap_plan p;

  INSERT INTO "_DeploymentFacetToSystem" ("A", "B")
  SELECT DISTINCT ds."A", p.provider_id
  FROM cap_plan p
  JOIN "_CapabilityToSystem" cs ON cs."A" = p.capability_id
  JOIN "_DeploymentFacetToSystem" ds ON ds."B" = cs."B"
  ON CONFLICT DO NOTHING;

  INSERT INTO "_SystemFrameworkScope" ("A", "B")
  SELECT DISTINCT fs."A", p.provider_id
  FROM cap_plan p
  JOIN "_CapabilityToSystem" cs ON cs."A" = p.capability_id
  JOIN "_SystemFrameworkScope" fs ON fs."B" = cs."B"
  ON CONFLICT DO NOTHING;

  -- The applicable Controls of every Provider and of every declaring System: controlAppliesToSystem /
  -- getApplicableControls written out in SQL (the Providers' own rows are in place by now, so they are
  -- read like any other System's):
  --   * applicability PER_SYSTEM or BOTH;
  --   * mapped (at any coverage) to a Requirement of a PUBLISHED Framework that is the base or in the
  --     System's declared Framework Scope;
  --   * no Deployment Facet scoping, or one Facet in common with the System;
  --   * each Impact Level threshold unset, or the System's level set and >= it (the enum's own order is
  --     LOW < MODERATE < HIGH < CRITICAL; an unclassified axis meets only an unset threshold).
  CREATE TEMP TABLE cap_applicable ON COMMIT DROP AS
  SELECT s."id" AS system_id, c."id" AS control_id
  FROM "System" s
  JOIN "Control" c ON c."applicability" IN ('PER_SYSTEM', 'BOTH')
  WHERE (s."id" IN (SELECT p.provider_id FROM cap_plan p) OR s."id" IN (SELECT cs."B" FROM "_CapabilityToSystem" cs))
    AND EXISTS (
      SELECT 1
      FROM "ControlMapping" m
      JOIN "Requirement" r ON r."id" = m."requirementId"
      JOIN "Framework" f ON f."id" = r."frameworkId"
      WHERE m."controlId" = c."id"
        AND f."status" = 'PUBLISHED'
        AND (f."isBase" OR EXISTS (SELECT 1 FROM "_SystemFrameworkScope" sc WHERE sc."A" = f."id" AND sc."B" = s."id"))
    )
    AND (
      NOT EXISTS (SELECT 1 FROM "_ControlToDeploymentFacet" cf WHERE cf."A" = c."id")
      OR EXISTS (
        SELECT 1 FROM "_ControlToDeploymentFacet" cf
        JOIN "_DeploymentFacetToSystem" sf ON sf."A" = cf."B"
        WHERE cf."A" = c."id" AND sf."B" = s."id"
      )
    )
    AND (c."minConfidentialityImpactLevel" IS NULL
         OR (s."confidentialityImpactLevel" IS NOT NULL AND s."confidentialityImpactLevel" >= c."minConfidentialityImpactLevel"))
    AND (c."minIntegrityImpactLevel" IS NULL
         OR (s."integrityImpactLevel" IS NOT NULL AND s."integrityImpactLevel" >= c."minIntegrityImpactLevel"))
    AND (c."minAvailabilityImpactLevel" IS NULL
         OR (s."availabilityImpactLevel" IS NOT NULL AND s."availabilityImpactLevel" >= c."minAvailabilityImpactLevel"));

  -- The Provider's Assessments: Fulfilled and noted for a mapped Control, Not Started for the rest.
  INSERT INTO "ControlAssessment" ("id", "systemId", "controlId", "status", "notes", "assessedAt", "updatedAt")
  SELECT gen_random_uuid()::text, p.provider_id, a.control_id,
         (CASE WHEN cc."A" IS NULL THEN 'NOT_STARTED' ELSE 'FULFILLED' END)::"ControlAssessmentStatus",
         CASE WHEN cc."A" IS NULL THEN NULL ELSE 'migrated from Capability "' || p.name || '" — verify' END,
         CASE WHEN cc."A" IS NULL THEN NULL ELSE v_now END,
         v_now
  FROM cap_plan p
  JOIN cap_applicable a ON a.system_id = p.provider_id
  LEFT JOIN "_CapabilityToControl" cc ON cc."A" = p.capability_id AND cc."B" = a.control_id
  ON CONFLICT ("systemId", "controlId") DO NOTHING;

  -- A Full Offering per mapped Control that applies to the Provider.
  INSERT INTO "ControlOffering" ("id", "providerId", "controlId", "type", "customerResponsibility", "createdAt", "updatedAt")
  SELECT gen_random_uuid()::text, p.provider_id, cc."B", 'FULL', NULL, v_now, v_now
  FROM cap_plan p
  JOIN "_CapabilityToControl" cc ON cc."A" = p.capability_id
  JOIN cap_applicable a ON a.system_id = p.provider_id AND a.control_id = cc."B"
  ON CONFLICT ("providerId", "controlId") DO NOTHING;

  -- Every declaring System depends on the Provider.
  INSERT INTO "ProviderDependency" ("id", "dependentId", "providerId", "createdAt")
  SELECT gen_random_uuid()::text, cs."B", p.provider_id, v_now
  FROM cap_plan p
  JOIN "_CapabilityToSystem" cs ON cs."A" = p.capability_id
  ON CONFLICT ("dependentId", "providerId") DO NOTHING;

  -- Auto-fulfilled Assessments go back to untouched where the Provider's Offering certainly takes over
  -- (see point 6 of the header); every other one is left exactly as it is.
  UPDATE "ControlAssessment" a
  SET "status" = 'NOT_STARTED', "assessedById" = NULL, "assessedAt" = NULL, "evidence" = NULL, "notes" = NULL,
      "selfAssessmentAnswer" = NULL, "fulfilledByCapabilityId" = NULL, "updatedAt" = v_now
  FROM cap_plan p
  WHERE a."fulfilledByCapabilityId" = p.capability_id
    AND a."assessedById" IS NULL
    AND a."status" = 'FULFILLED'
    AND a."evidence" IS NULL
    AND a."selfAssessmentAnswer" IS NULL
    AND (a."notes" IS NULL OR a."notes" LIKE 'Inherited via %')
    AND EXISTS (SELECT 1 FROM "ProviderDependency" d WHERE d."dependentId" = a."systemId" AND d."providerId" = p.provider_id)
    AND EXISTS (SELECT 1 FROM "ControlOffering" o WHERE o."providerId" = p.provider_id AND o."controlId" = a."controlId")
    AND EXISTS (SELECT 1 FROM cap_applicable x WHERE x.system_id = a."systemId" AND x.control_id = a."controlId")
    AND NOT EXISTS (SELECT 1 FROM "ControlOffering" own WHERE own."providerId" = a."systemId" AND own."controlId" = a."controlId");
  GET DIAGNOSTICS v_reset = ROW_COUNT;

  -- One "system" event on each System that declared a Capability.
  INSERT INTO "ChangeEvent" ("id", "systemId", "action", "detail", "actorId", "createdAt")
  SELECT gen_random_uuid()::text, cs."B", 'CLASSIFICATION_CHANGED',
         'Capability "' || p.name || '" migrated to a dependency on Provider "' || p.name || '"',
         'system', v_now
  FROM cap_plan p
  JOIN "_CapabilityToSystem" cs ON cs."A" = p.capability_id;

  SELECT count(*) INTO v_providers FROM cap_plan;
  SELECT count(*) INTO v_offerings FROM "ControlOffering" o WHERE o."providerId" IN (SELECT provider_id FROM cap_plan);
  SELECT count(*) INTO v_dependencies FROM "ProviderDependency" d WHERE d."providerId" IN (SELECT provider_id FROM cap_plan);
  SELECT count(*) INTO v_kept FROM "ControlAssessment" a WHERE a."fulfilledByCapabilityId" IS NOT NULL;
  SELECT count(*) INTO v_dropped
  FROM cap_plan p
  JOIN "_CapabilityToControl" cc ON cc."A" = p.capability_id
  WHERE NOT EXISTS (SELECT 1 FROM "ControlOffering" o WHERE o."providerId" = p.provider_id AND o."controlId" = cc."B");
  RAISE NOTICE 'Retire Capability: % Provider(s) created, % Offering(s), % dependency(ies), % auto-fulfilled Assessment(s) reset to untouched, % left as they are, % mapped Control(s) without an Offering',
    v_providers, v_offerings, v_dependencies, v_reset, v_kept, v_dropped;
END $$;

-- DropColumn (also drops its foreign key)
ALTER TABLE "ControlAssessment" DROP COLUMN IF EXISTS "fulfilledByCapabilityId";

-- DropTable
DROP TABLE IF EXISTS "_CapabilityToControl";

-- DropTable
DROP TABLE IF EXISTS "_CapabilityToSystem";

-- DropTable
DROP TABLE IF EXISTS "Capability";
