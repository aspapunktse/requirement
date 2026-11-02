/**
 * Read-only pre-deploy check for migration `20261102120000_add_sensitivity_level`
 * (#290, ADR 0011), which replaces the Confidentiality Impact Level with a Sensitivity Level
 * on every System and as a minimum on every Control.
 *
 * It reports what the migration will do against the database in DATABASE_URL, so the product owner
 * can run it against production before merging. It writes nothing (only SELECTs).
 *
 *   npx tsx scripts/check-sensitivity-level-migration.ts
 *
 * For Systems and for Controls it prints the count per Confidentiality value and the Sensitivity
 * Level each becomes (LOW -> 2 Internal, MODERATE -> 3 Sensitive, HIGH -> 4 Highly Sensitive,
 * CRITICAL -> 5 Critical Sensitivity, none -> none; nothing becomes 1 Public).
 *
 * The migration cannot abort: every old value goes through a CASE with a NULL fallback, the new
 * foreign keys point at the five rows the migration inserts itself, and on an empty database it only
 * creates and fills the new table. So this script exits 1 only when it cannot tell, that is when it
 * cannot read the old columns for a reason other than the migration having already run, and 0
 * otherwise.
 *
 * It reads with raw SQL because, after this change, the Prisma client no longer has the old
 * columns, and it works on a database where they are already gone ("nothing to migrate").
 */
import { prisma } from "../src/lib/prisma";

/** Must match the CASE in the migration. */
const BECOMES: Record<string, string> = {
  LOW: "2 Internal",
  MODERATE: "3 Sensitive",
  HIGH: "4 Highly Sensitive",
  CRITICAL: "5 Critical Sensitivity",
};

const columnExists = async (table: string, column: string) =>
  (
    await prisma.$queryRaw<{ exists: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = ${table} AND column_name = ${column}
      ) AS exists`
  )[0].exists;

async function report(label: string, table: "System" | "Control", column: string) {
  if (!(await columnExists(table, column))) {
    console.log(`${label}: no "${column}" column; the migration has already been applied (or this is a fresh database).`);
    return;
  }
  const rows = await prisma.$queryRawUnsafe<{ value: string | null; count: bigint }[]>(
    `SELECT "${column}"::text AS value, count(*) AS count FROM "${table}" GROUP BY 1 ORDER BY 1`,
  );
  const total = rows.reduce((sum, row) => sum + Number(row.count), 0);
  console.log(`${label}: ${total}`);
  if (total === 0) console.log("  (none: nothing to copy)");
  for (const { value, count } of rows) {
    const becomes = value === null ? "not set (stays not set)" : (BECOMES[value] ?? "not set (UNEXPECTED value, becomes not set)");
    console.log(`  ${value ?? "not set"}: ${count} -> ${becomes}`);
  }
}

async function main() {
  await report("Systems", "System", "confidentialityImpactLevel");
  await report("Controls (minimum)", "Control", "minConfidentialityImpactLevel");
  console.log("\nRESULT: the migration cannot abort; it only creates the SensitivityLevel table, copies the values above and drops the old columns.");
}

main()
  .catch((error) => {
    console.error("Could not read the database:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
