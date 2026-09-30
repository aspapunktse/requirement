/**
 * Read-only check: lists Per-System/Both Controls that are mapped to no
 * Requirement of a Published Framework.
 *
 * Since ADR 0007 / #85, a Control applies to a System only if it's mapped to a
 * Requirement of a Published Framework in that System's effective Framework
 * Scope. A Per-System/Both Control with no such mapping applies to *no* System,
 * so a recompute would delete its untouched Assessments (and one created in the
 * admin UI without a mapping silently drops out). Run this before deploying
 * anything that changes applicability, and map or retire whatever it lists.
 *
 * Writes nothing. Exits 0 either way (it's a report), printing the count.
 *
 *   npx tsx scripts/check-unmapped-controls.ts
 */
import { prisma } from "../src/lib/prisma";

async function main() {
  const unmapped = await prisma.control.findMany({
    where: {
      applicability: { in: ["PER_SYSTEM", "BOTH"] },
      mappings: { none: { requirement: { framework: { status: "PUBLISHED" } } } },
    },
    select: {
      code: true,
      title: true,
      applicability: true,
      mappings: { select: { requirement: { select: { framework: { select: { name: true, status: true } } } } } },
    },
    orderBy: { code: "asc" },
  });

  const [perSystemOrBoth, published] = await Promise.all([
    prisma.control.count({ where: { applicability: { in: ["PER_SYSTEM", "BOTH"] } } }),
    prisma.framework.count({ where: { status: "PUBLISHED" } }),
  ]);

  console.log(`Published Frameworks: ${published}`);
  console.log(`Per-System/Both Controls: ${perSystemOrBoth}`);
  console.log(`Unmapped to any Published Framework: ${unmapped.length}`);
  for (const control of unmapped) {
    const drafts = [...new Set(control.mappings.map((m) => m.requirement.framework.name))];
    const note = drafts.length > 0 ? ` (mapped only to Draft: ${drafts.join(", ")})` : "";
    console.log(`  ${control.code}  [${control.applicability}]  ${control.title}${note}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
