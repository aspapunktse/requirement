import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * The data step of the migration `20261128100000_boundary_statement_of_applicability` (#420), run on fixtures. The old column is
 * gone from the schema, so each test adds it back inside a transaction, creates its fixtures, runs the migration's own `DO` block
 * (read from the SQL file, so the test cannot drift from it) and asserts, then rolls everything back by throwing. Nothing is
 * left in the database, and the base Framework's flag is never touched.
 */
const sql = readFileSync(path.join(process.cwd(), "prisma/migrations/20261128100000_boundary_statement_of_applicability/migration.sql"), "utf8");
const DATA_STEP = /DO \$\$[\s\S]*?END \$\$;/.exec(sql)?.[0] ?? "";
const ROLLBACK = "rollback-on-purpose";
const suffix = `${process.pid}-${Date.now()}`;

async function inRolledBackTransaction(run: (tx: Prisma.TransactionClient) => Promise<void>) {
  await expect(
    prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe('ALTER TABLE "Control" ADD COLUMN "soaExclusionJustification" TEXT');
        await run(tx);
        throw new Error(ROLLBACK);
      },
      { timeout: 60_000, maxWait: 30_000 },
    ),
  ).rejects.toThrow(ROLLBACK);
}

async function fixtures(tx: Prisma.TransactionClient) {
  const base = await tx.framework.findFirstOrThrow({ where: { isBase: true } });
  const other = await tx.framework.create({ data: { name: `Test 420 mig other ${suffix}`, version: "1", status: "PUBLISHED" } });
  const control = async (code: string, justification: string | null) => {
    const row = await tx.control.create({ data: { code: `T420M-${code}-${suffix}`, title: code, description: "d", category: "Test", applicability: "ORGANIZATIONAL" } });
    if (justification !== null) await tx.$executeRaw`UPDATE "Control" SET "soaExclusionJustification" = ${justification} WHERE "id" = ${row.id}`;
    return row.id;
  };
  const requirement = async (frameworkId: string, code: string, controlIds: string[]) =>
    (await tx.requirement.create({ data: { frameworkId, code: `T420M-${code}-${suffix}`, section: "Test", title: code, text: "t", mappings: { create: controlIds.map((controlId) => ({ controlId, coverage: "FULL" as const })) } } })).id;
  const owner = await tx.user.create({ data: { email: `test-420-mig-${suffix}@example.com`, name: "Test 420 mig", role: "SYSTEM_OWNER" } });
  const system = await tx.system.create({ data: { name: `Test 420 mig system ${suffix}`, ownerId: owner.id } });
  return { base, other, control, requirement, system };
}

const boundaryNamed = (tx: Prisma.TransactionClient, like: string) =>
  tx.complianceBoundary.findFirst({ where: { name: like }, include: { frameworks: true, systems: true, exclusionJustifications: { orderBy: { requirementId: "asc" } } } });

describe("the ISMS Boundary migration's data step (#420)", { timeout: 90_000 }, () => {
  it("found the data step in the migration file", () => {
    expect(DATA_STEP.startsWith("DO $$")).toBe(true);
  });

  it("creates the Boundary with the base Framework and every System, and copies the justifications onto the base Requirements", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { base, other, control, requirement, system } = await fixtures(tx);
      const single = await control("SINGLE", "  Not used here  ");
      const twoA = await control("TWOA", "Out of scope");
      const twoB = await control("TWOB", "Handled elsewhere");
      const twoC = await control("TWOC", "Out of scope"); // the same text as twoA: one copy
      const blank = await control("BLANK", "   ");
      const none = await control("NONE", null);
      const onlyOther = await control("OTHER", "Maps to another Framework only");
      const rSingle = await requirement(base.id, "R1", [single]);
      const rTwo = await requirement(base.id, "R2", [twoA, twoB, twoC]);
      const rBlank = await requirement(base.id, "R3", [blank, none]);
      await requirement(other.id, "R4", [onlyOther]);
      const existing = await tx.complianceBoundary.count({ where: { name: "ISMS scope (ISO 27001)" } });

      await tx.$executeRawUnsafe(DATA_STEP);

      const boundary = await boundaryNamed(tx, existing === 0 ? "ISMS scope (ISO 27001)" : "ISMS scope (ISO 27001) (migrated)");
      expect(boundary).not.toBeNull();
      expect(boundary!.frameworks.map((f) => f.frameworkId)).toEqual([base.id]);
      expect(boundary!.systems.map((s) => s.systemId)).toContain(system.id);
      expect(boundary!.systems.length).toBe(await tx.system.count());
      expect(boundary!.retiredAt).toBeNull();
      const text = new Map(boundary!.exclusionJustifications.map((j) => [j.requirementId, j.text]));
      expect(text.get(rSingle)).toBe("Not used here");
      // Distinct texts combined, sorted, a blank line between: nothing lost, the duplicate kept once.
      expect(text.get(rTwo)).toBe("Handled elsewhere\n\nOut of scope");
      expect(text.has(rBlank)).toBe(false);
      // The Control mapped only to another Framework has no base Requirement: its text goes in the description, not dropped.
      expect(boundary!.description).toContain(`T420M-OTHER-${suffix}: Maps to another Framework only`);
      expect(boundary!.description).not.toContain("Not used here");
    });
  });

  it("runs twice without raising or duplicating: the second run only adds a suffixed Boundary, and never a second row for a pair", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { base, control, requirement } = await fixtures(tx);
      const c = await control("TWICE", "Once");
      const r = await requirement(base.id, "R5", [c]);
      await tx.$executeRawUnsafe(DATA_STEP);
      await tx.$executeRawUnsafe(DATA_STEP);
      const rows = await tx.boundaryExclusionJustification.findMany({ where: { requirementId: r } });
      // Two Boundaries (the second under a suffixed name), one row each, never two for the same pair.
      expect(rows).toHaveLength(2);
      expect(new Set(rows.map((row) => row.boundaryId)).size).toBe(2);
    });
  });
});
