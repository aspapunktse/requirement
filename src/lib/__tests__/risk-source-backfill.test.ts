import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createCheckUpScenario } from "@/test/check-up-fixtures";

/**
 * The Risk Source backfill (#322, PRD 0002 migration note 4): an Assessment link means requirement
 * non-conformance, a Check-up link means audit finding, anything else is ad hoc. The test runs the
 * migration's own UPDATE statement (read from the file, narrowed to this file's fixture Risks), so
 * the SQL that ships is the SQL under test. Fixtures only, since CI's database isn't seeded.
 */

const MIGRATION = "20261109120000_add_risk_source";

function backfillSql() {
  const sql = readFileSync(join(process.cwd(), "prisma", "migrations", MIGRATION, "migration.sql"), "utf-8");
  const update = sql.match(/UPDATE "Risk"[\s\S]*?;/);
  if (!update) throw new Error("no UPDATE in the migration");
  return update[0].replace(/;$/, "");
}

describe("the Risk Source backfill", () => {
  let s: Awaited<ReturnType<typeof createCheckUpScenario>>;
  const ids: Record<string, string> = {};

  /** The statement as written in the migration, limited to the given Risks. */
  const runBackfill = (riskIds: string[]) => prisma.$executeRawUnsafe(`${backfillSql()} WHERE "id" = ANY($1)`, riskIds);
  const sourceOf = async (id: string) => (await prisma.risk.findUniqueOrThrow({ where: { id } })).source;

  beforeAll(async () => {
    s = await createCheckUpScenario("322b", { systemControls: 2, organizationControls: 0 });
    const assessment = await prisma.controlAssessment.create({ data: { systemId: s.systemId, controlId: s.systemControls[0].id, status: "IN_PROGRESS", selfAssessmentAnswer: "NO" } });
    const base = { title: `Test 322 backfill ${s.suffix}`, description: "d", severity: "LOW" as const, likelihood: "LOW" as const };
    const checkUp = s.find(s.systemControls[1].code);
    const make = async (key: string, data: object) => {
      // Written as "wrong" first: the backfill must put each one right, not leave a default.
      ids[key] = (await prisma.risk.create({ data: { ...base, source: "REQUIREMENT_NONCONFORMANCE", ...data } })).id;
    };
    await make("adHoc", { systemId: s.systemId });
    await make("assessment", { systemId: s.systemId, controlAssessmentId: assessment.id });
    await make("checkUp", { systemId: s.systemId, checkUpId: checkUp.id });
  });

  afterAll(async () => {
    await s.cleanup();
  });

  it("gives each Risk its source from its links, and is the same when run again", async () => {
    await runBackfill(Object.values(ids));
    const expected = { adHoc: "AD_HOC", assessment: "REQUIREMENT_NONCONFORMANCE", checkUp: "AUDIT_FINDING" };
    for (const [key, source] of Object.entries(expected)) expect(await sourceOf(ids[key]), key).toBe(source);

    await runBackfill(Object.values(ids));
    for (const [key, source] of Object.entries(expected)) expect(await sourceOf(ids[key]), key).toBe(source);
  });

  it("prefers the Check-up when a Risk has both links, and does nothing to no Risks", async () => {
    const assessment = await prisma.controlAssessment.findFirstOrThrow({ where: { systemId: s.systemId } });
    await prisma.risk.update({ where: { id: ids.checkUp }, data: { controlAssessmentId: assessment.id, source: "AD_HOC" } });
    await runBackfill([ids.checkUp]);
    expect(await sourceOf(ids.checkUp)).toBe("AUDIT_FINDING");
    expect(await runBackfill([])).toBe(0);
  });

  it("leaves the column NOT NULL with the ad hoc default", async () => {
    const [column] = await prisma.$queryRaw<{ is_nullable: string; column_default: string }[]>`
      SELECT is_nullable, column_default FROM information_schema.columns WHERE table_name = 'Risk' AND column_name = 'source'`;
    expect(column.is_nullable).toBe("NO");
    expect(column.column_default).toContain("AD_HOC");
  });
});
