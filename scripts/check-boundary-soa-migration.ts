/**
 * Read-only pre-deploy check for migration `20261128100000_boundary_statement_of_applicability` (#420, ADR 0016), which moves
 * every Control's Statement of Applicability exclusion justification onto a seeded "ISMS scope (ISO 27001)" Compliance Boundary.
 *
 * It reports what the migration will do against the database in DATABASE_URL, so the product owner can run it against
 * production before merging. It writes nothing (only SELECTs). The migration itself cannot abort (it raises nothing and every
 * insert is ON CONFLICT DO NOTHING), so this script exits 0 always and only reports; it exits 1 only if it cannot read the database.
 *
 *   npx tsx scripts/check-boundary-soa-migration.ts
 *
 * It prints:
 * - whether there is a base Framework (without one the migration creates nothing);
 * - Controls with a justification but no base-Framework Requirement. These have no Requirement to move to: the migration
 *   appends their text to the new Boundary's description instead of dropping it, so check the text is still wanted;
 * - Requirements that would get a combined text (several Controls with different justifications map to one base Requirement);
 * - Requirements that get one Control's text as it is (a count);
 * - whether a Boundary with the migration's name already exists (the new one then gets a suffix);
 * - how many Systems the Boundary will hold.
 *
 * It reads the old column with raw SQL because after the migration the Prisma client no longer has it, and it works on a
 * database where the migration has already run ("nothing to migrate").
 */
import { prisma } from "../src/lib/prisma";

const BOUNDARY_NAME = "ISMS scope (ISO 27001)";

type Justified = { id: string; code: string; title: string; text: string };

async function main() {
  const column = await prisma.$queryRawUnsafe<{ exists: boolean }[]>(
    `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Control' AND column_name = 'soaExclusionJustification') AS exists`,
  );
  if (!column[0].exists) {
    console.log("Control.soaExclusionJustification is gone: the migration has already been applied (or this is a fresh database). Nothing to migrate.");
    return;
  }

  const base = await prisma.framework.findFirst({ where: { isBase: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true, name: true, version: true } });
  const justified = await prisma.$queryRawUnsafe<Justified[]>(
    `SELECT "id", "code", "title", btrim("soaExclusionJustification") AS "text" FROM "Control" WHERE btrim(coalesce("soaExclusionJustification", '')) <> '' ORDER BY "code", "id"`,
  );
  console.log(`Controls with an exclusion justification: ${justified.length}`);

  if (!base) {
    console.log("\nThere is no base Framework: the migration creates no Boundary and copies nothing, then drops the column.");
    if (justified.length > 0) console.log(`!! ${justified.length} justification(s) would be LOST: there is no base Framework to attach them to.`);
    return;
  }
  console.log(`Base Framework: ${base.name} ${base.version}`);

  const existing = await prisma.$queryRawUnsafe<{ name: string }[]>(`SELECT "name" FROM "ComplianceBoundary" WHERE lower("name") = lower($1)`, BOUNDARY_NAME);
  console.log(
    existing.length > 0
      ? `A Boundary named "${existing[0].name}" already exists: the migration leaves it alone and names the new one "${BOUNDARY_NAME} (migrated)".`
      : `No Boundary named "${BOUNDARY_NAME}" yet: the migration creates it.`,
  );
  console.log(`Systems the new Boundary will hold: ${await prisma.system.count()} (every System, closed ones included).`);

  const mappings = await prisma.controlMapping.findMany({
    where: { controlId: { in: justified.map((control) => control.id) }, requirement: { frameworkId: base.id } },
    select: { controlId: true, requirement: { select: { id: true, code: true, title: true } } },
  });
  const requirementsOfControl = new Map<string, number>();
  const textsByRequirement = new Map<string, { code: string; title: string; controls: Map<string, string> }>();
  const textOf = new Map(justified.map((control) => [control.id, control]));
  for (const mapping of mappings) {
    requirementsOfControl.set(mapping.controlId, (requirementsOfControl.get(mapping.controlId) ?? 0) + 1);
    const entry = textsByRequirement.get(mapping.requirement.id) ?? { code: mapping.requirement.code, title: mapping.requirement.title, controls: new Map<string, string>() };
    entry.controls.set(mapping.controlId, textOf.get(mapping.controlId)!.text);
    textsByRequirement.set(mapping.requirement.id, entry);
  }

  const orphans = justified.filter((control) => !requirementsOfControl.has(control.id));
  console.log(`\nControls with a justification but NO base-Framework Requirement (text appended to the Boundary's description, not dropped): ${orphans.length}`);
  for (const control of orphans) console.log(`  - ${control.code} ${control.title}: "${control.text.slice(0, 120)}${control.text.length > 120 ? "…" : ""}"`);

  const combined = [...textsByRequirement.values()].filter((entry) => new Set(entry.controls.values()).size > 1);
  console.log(`\nBase Requirements that get a COMBINED text (different justifications from several Controls): ${combined.length}`);
  for (const entry of combined.sort((a, b) => a.code.localeCompare(b.code, "en", { numeric: true }))) {
    console.log(`  - ${entry.code} ${entry.title}: ${[...new Set(entry.controls.values())].length} texts, from Controls ${[...entry.controls.keys()].map((id) => textOf.get(id)!.code).join(", ")}`);
  }

  console.log(`\nBase Requirements that get a justification: ${textsByRequirement.size} (of which ${combined.length} combined).`);
  console.log("\nRESULT: the migration would complete; it cannot abort. Review the NO-Requirement and COMBINED lists above.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
