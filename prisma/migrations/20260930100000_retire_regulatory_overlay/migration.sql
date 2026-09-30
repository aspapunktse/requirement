-- Retire Regulatory Overlay (ADR 0007, #88).
--
-- Each overlay becomes a Framework and every System that declared it gets that
-- Framework in its Framework Scope, then the overlay tables are dropped.
--
-- Join-table column semantics (Prisma orders the sides alphabetically by model):
--   "_ControlToRegulatoryOverlay":  A = Control id,           B = RegulatoryOverlay id
--   "_RegulatoryOverlayToSystem":   A = RegulatoryOverlay id, B = System id
--   "_SystemFrameworkScope":        A = Framework id,         B = System id
--
-- THE INVARIANT: for every System, the applicable-Control set and every
-- Control Assessment are identical before and after. This migration writes no
-- Assessment rows and no Change Events, so the Assessments are untouched.
--
-- Why it is not a straight "make a placeholder Requirement per overlay-scoped
-- Control": the new model has no "base AND overlay" (the Framework gate is an OR
-- across the Frameworks in scope). Analysing each case:
--
--   1. Overlay-scoped Control mapped to NO Published Framework. Today the
--      Framework gate (#85) fails for every System, so it applies to nothing.
--      Mapping it to the new Framework X would make it START applying to every
--      System declaring X, a widening. So NO mapping/Requirement is created; the
--      Control stays exactly as inapplicable as it is today. (Its overlay tag is
--      lost with the drop; scripts/check-overlay-migration.ts lists these before
--      deploy so a curator can map them to a Framework deliberately.)
--   2. Overlay-scoped Control mapped to a Published Framework (typically the
--      base). Today it applies only to Systems declaring one of its overlays; the
--      base gate passes everywhere and the overlay axis restricts it. Once the
--      axis is gone its base mapping alone makes it apply to EVERY System, and
--      the Framework gate cannot express "base AND X". The migration therefore
--      ABORTS (RAISE EXCEPTION, nothing changed) and lists the Control codes.
--      Someone must decide, per Control, what the scoping should become.
--   3. A Control scoped to two overlays X and Y falls under (1) or (2): unmapped
--      it applies to nothing before and after; mapped to a Published Framework
--      the migration aborts. (Had a mapping been created for it, "declares X or
--      Y" and "Framework X or Y in scope" are both an OR, so that would have
--      been equivalent too, but no mapping is created.)
--   Since every overlay-scoped Control that could pass the Framework gate for
--   some System is mapped to a Published Framework, case 2 catches all of them:
--   after the abort check no overlay-scoped Control passes the gate, and none
--   gets a mapping. New Frameworks therefore start with no Requirements.
--
-- A collision on (name, version) reuses the existing Framework. If that
-- Framework is Published, not the base, has mapped Requirements, and a
-- declaring System does not already have it in scope, adding the scope row would
-- give that System new applicable Controls, so that case aborts too. Reusing a
-- Draft or empty Framework, or one the System already scopes, changes nothing.
--
-- Data-driven (no ids or display names hard-coded), a no-op on an empty
-- database, and safe to re-run in principle (ON CONFLICT DO NOTHING). Prisma
-- runs the whole file as one transaction, so an abort leaves nothing behind
-- (the failed migration must then be resolved with `prisma migrate resolve
-- --rolled-back` after the cause is dealt with).

DO $$
DECLARE
  offenders text;
BEGIN
  -- Abort check 1: overlay-scoped Controls mapped to a Published Framework.
  SELECT string_agg(DISTINCT c."code", ', ' ORDER BY c."code") INTO offenders
  FROM "Control" c
  WHERE EXISTS (SELECT 1 FROM "_ControlToRegulatoryOverlay" co WHERE co."A" = c."id")
    AND EXISTS (
      SELECT 1
      FROM "ControlMapping" m
      JOIN "Requirement" r ON r."id" = m."requirementId"
      JOIN "Framework" f ON f."id" = r."frameworkId"
      WHERE m."controlId" = c."id" AND f."status" = 'PUBLISHED'
    );
  IF offenders IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot retire Regulatory Overlay: these Controls are scoped to an overlay AND mapped to a Published Framework, and removing the overlay would widen where they apply to every System: %. Decide per Control (unmap it from the Published Framework, or drop its overlay scoping) and re-run. See scripts/check-overlay-migration.ts.', offenders;
  END IF;

  -- Abort check 2: reusing an existing Published Framework that would give
  -- declaring Systems new applicable Controls.
  SELECT string_agg(DISTINCT o."name", ', ' ORDER BY o."name") INTO offenders
  FROM "RegulatoryOverlay" o
  JOIN "Framework" f ON f."name" = o."name" AND f."version" = '1'
  WHERE f."status" = 'PUBLISHED'
    AND f."isBase" = false
    AND EXISTS (
      SELECT 1
      FROM "Requirement" r
      JOIN "ControlMapping" m ON m."requirementId" = r."id"
      WHERE r."frameworkId" = f."id"
    )
    AND EXISTS (
      SELECT 1
      FROM "_RegulatoryOverlayToSystem" os
      WHERE os."A" = o."id"
        AND NOT EXISTS (
          SELECT 1 FROM "_SystemFrameworkScope" s WHERE s."A" = f."id" AND s."B" = os."B"
        )
    );
  IF offenders IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot retire Regulatory Overlay: a Published Framework named like these overlays (version 1) already exists with mapped Controls, and putting it into the scope of the Systems that declared the overlay would give them new applicable Controls: %. Rename the overlay or the Framework and re-run. See scripts/check-overlay-migration.ts.', offenders;
  END IF;
END $$;

-- One Framework per overlay: version '1', QUOTABLE (a curator can change it),
-- Published (the overlay drives applicability today, so Draft would be inert).
-- Reuses an existing Framework of the same name and version.
INSERT INTO "Framework" ("id", "name", "version", "description", "strictComplianceRequired", "licensing", "isBase", "status", "createdAt")
SELECT gen_random_uuid()::text, o."name", '1', o."description", false, 'QUOTABLE', false, 'PUBLISHED', CURRENT_TIMESTAMP
FROM "RegulatoryOverlay" o
ON CONFLICT ("name", "version") DO NOTHING;

-- Every System that declared the overlay gets the Framework in its scope.
INSERT INTO "_SystemFrameworkScope" ("A", "B")
SELECT f."id", os."B"
FROM "_RegulatoryOverlayToSystem" os
JOIN "RegulatoryOverlay" o ON o."id" = os."A"
JOIN "Framework" f ON f."name" = o."name" AND f."version" = '1'
ON CONFLICT DO NOTHING;

-- DropTable
DROP TABLE "_ControlToRegulatoryOverlay";

-- DropTable
DROP TABLE "_RegulatoryOverlayToSystem";

-- DropTable
DROP TABLE "RegulatoryOverlay";
