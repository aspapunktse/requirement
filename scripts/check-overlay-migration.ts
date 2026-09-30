/**
 * Read-only pre-deploy check for migration `20260930100000_retire_regulatory_overlay`
 * (#88, ADR 0007), which turns every Regulatory Overlay into a Framework.
 *
 * It reports what the migration will do against the database in DATABASE_URL and
 * whether it will ABORT, so the product owner can run it against production
 * before merging. It writes nothing (only SELECTs) and exits 1 when the migration
 * would abort, 0 otherwise.
 *
 *   npx tsx scripts/check-overlay-migration.ts
 *
 * Why the migration can abort: the new model has no "base AND overlay". Today a
 * Control scoped to an overlay and mapped to a Published Framework (typically the
 * base) applies only to Systems declaring that overlay; once the overlay is gone
 * its mapping alone makes it apply to every System. The migration refuses to
 * widen applicability silently, so it stops and lists those Controls. Everything
 * else keeps every System's applicable-Control set and every Assessment exactly
 * as they are (see the comments in the migration).
 *
 * It uses raw SQL because, after this change, the Prisma client no longer has a
 * RegulatoryOverlay model.
 */
import { prisma } from "../src/lib/prisma";

type OverlayRow = { id: string; name: string; description: string | null };
type FrameworkRow = { id: string; status: string; isBase: boolean; mapped: number; requirements: number };

async function main() {
  const [{ exists }] = await prisma.$queryRawUnsafe<{ exists: boolean }[]>(
    `SELECT to_regclass('"RegulatoryOverlay"') IS NOT NULL AS exists`,
  );
  if (!exists) {
    console.log("No RegulatoryOverlay table: the migration has already been applied (or this is a fresh database). Nothing to check.");
    return;
  }

  const overlays = await prisma.$queryRawUnsafe<OverlayRow[]>(
    `SELECT "id", "name", "description" FROM "RegulatoryOverlay" ORDER BY "name"`,
  );
  console.log(`Regulatory Overlays: ${overlays.length}`);

  let wouldAbort = false;

  // Per overlay: target Framework, declaring Systems, scoped Controls.
  for (const overlay of overlays) {
    const [framework] = await prisma.$queryRawUnsafe<FrameworkRow[]>(
      `SELECT f."id", f."status"::text AS status, f."isBase",
              (SELECT count(*)::int FROM "Requirement" r WHERE r."frameworkId" = f."id") AS requirements,
              (SELECT count(*)::int FROM "Requirement" r JOIN "ControlMapping" m ON m."requirementId" = r."id"
                 WHERE r."frameworkId" = f."id") AS mapped
       FROM "Framework" f WHERE f."name" = $1 AND f."version" = '1'`,
      overlay.name,
    );
    const declaring = await prisma.$queryRawUnsafe<{ id: string; name: string; has_scope: boolean }[]>(
      `SELECT s."id", s."name",
              ${framework ? `EXISTS (SELECT 1 FROM "_SystemFrameworkScope" sc WHERE sc."A" = '${framework.id}' AND sc."B" = s."id")` : "false"} AS has_scope
       FROM "_RegulatoryOverlayToSystem" os JOIN "System" s ON s."id" = os."B"
       WHERE os."A" = $1 ORDER BY s."name"`,
      overlay.id,
    );
    const scoped = await prisma.$queryRawUnsafe<{ code: string }[]>(
      `SELECT c."code" FROM "_ControlToRegulatoryOverlay" co JOIN "Control" c ON c."id" = co."A"
       WHERE co."B" = $1 ORDER BY c."code"`,
      overlay.id,
    );

    console.log(`\nOverlay "${overlay.name}"`);
    if (!framework) {
      console.log(`  Framework: would CREATE "${overlay.name}" version 1, QUOTABLE, PUBLISHED, not base (0 Requirements)`);
    } else {
      console.log(
        `  Framework: would REUSE the existing "${overlay.name}" version 1 (${framework.status}${framework.isBase ? ", base" : ""}, ` +
          `${framework.requirements} Requirement(s), ${framework.mapped} Control Mapping(s)); name+version collision`,
      );
    }
    const newScopes = declaring.filter((s) => !s.has_scope);
    console.log(
      `  Systems declaring it: ${declaring.length}; Framework Scope rows to add: ${newScopes.length}` +
        (declaring.length - newScopes.length > 0 ? ` (${declaring.length - newScopes.length} already in scope)` : ""),
    );
    for (const s of declaring) console.log(`    - ${s.name}${s.has_scope ? " (already in scope)" : ""}`);
    console.log(`  Controls scoped to it: ${scoped.length}${scoped.length > 0 ? ` (${scoped.map((c) => c.code).join(", ")})` : ""}`);

    // Abort check 2: reusing a Published, non-base Framework with mapped Controls would give new Controls to
    // Systems that don't already scope it.
    if (framework && framework.status === "PUBLISHED" && !framework.isBase && framework.mapped > 0 && newScopes.length > 0) {
      wouldAbort = true;
      console.log(
        `  !! WOULD ABORT: the existing Published Framework has mapped Controls, so scoping it into ${newScopes.length} System(s) would give them new applicable Controls.`,
      );
    }
  }

  // Abort check 1 and the warnings, per overlay-scoped Control.
  const controls = await prisma.$queryRawUnsafe<
    {
      code: string;
      title: string;
      applicability: string;
      overlays: string[];
      published: string[] | null;
      drafts: string[] | null;
    }[]
  >(
    `SELECT c."code", c."title", c."applicability"::text AS applicability,
            (SELECT array_agg(o."name" ORDER BY o."name") FROM "_ControlToRegulatoryOverlay" co
               JOIN "RegulatoryOverlay" o ON o."id" = co."B" WHERE co."A" = c."id") AS overlays,
            (SELECT array_agg(DISTINCT f."name" || ' ' || f."version") FROM "ControlMapping" m
               JOIN "Requirement" r ON r."id" = m."requirementId" JOIN "Framework" f ON f."id" = r."frameworkId"
               WHERE m."controlId" = c."id" AND f."status" = 'PUBLISHED') AS published,
            (SELECT array_agg(DISTINCT f."name" || ' ' || f."version") FROM "ControlMapping" m
               JOIN "Requirement" r ON r."id" = m."requirementId" JOIN "Framework" f ON f."id" = r."frameworkId"
               WHERE m."controlId" = c."id" AND f."status" = 'DRAFT') AS drafts
     FROM "Control" c
     WHERE EXISTS (SELECT 1 FROM "_ControlToRegulatoryOverlay" co WHERE co."A" = c."id")
     ORDER BY c."code"`,
  );

  const offenders = controls.filter((c) => (c.published ?? []).length > 0);
  const draftOnly = controls.filter((c) => (c.published ?? []).length === 0 && (c.drafts ?? []).length > 0);
  const unmapped = controls.filter((c) => (c.published ?? []).length === 0 && (c.drafts ?? []).length === 0);

  console.log(`\nOverlay-scoped Controls: ${controls.length}`);
  console.log(`  mapped to a Published Framework (the migration ABORTS on these): ${offenders.length}`);
  for (const c of offenders) {
    console.log(`    ${c.code} [${c.applicability}] ${c.title}  overlays: ${c.overlays.join(", ")}  mapped to: ${(c.published ?? []).join(", ")}`);
  }
  console.log(`  mapped only to Draft Frameworks (migrated, loses its overlay restriction; if later published it applies to every System in scope): ${draftOnly.length}`);
  for (const c of draftOnly) {
    console.log(`    ${c.code} [${c.applicability}] ${c.title}  overlays: ${c.overlays.join(", ")}  draft: ${(c.drafts ?? []).join(", ")}`);
  }
  console.log(`  mapped to no Framework (applies to nothing today, stays that way; NO Requirement/mapping is created, its overlay tag is dropped): ${unmapped.length}`);
  for (const c of unmapped) {
    console.log(`    ${c.code} [${c.applicability}] ${c.title}  overlays: ${c.overlays.join(", ")}`);
  }
  if (offenders.length > 0) wouldAbort = true;

  console.log("\nPlaceholder Requirements / Control Mappings the migration will create: 0 (by design; see the migration's header)");
  console.log(
    wouldAbort
      ? "\nRESULT: the migration WOULD ABORT (see the !! lines and the Controls mapped to a Published Framework). Decide per Control, then re-run this check."
      : "\nRESULT: the migration would complete, and every System's applicable-Control set and every Assessment stays exactly as it is.",
  );
  if (wouldAbort) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
