import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { clearGapAcceptance, loadCoverageSummaries, loadFrameworkCoverage } from "../framework-coverage";

/**
 * Coverage derivation against a real Postgres (#74). All fixtures are created
 * here and removed afterwards (CI's DB is migrated but not seeded).
 */
const SUFFIX = Date.now();

describe("Framework coverage (database)", () => {
  let mixedId: string;
  let emptyId: string;
  let userId: string;
  const controlIds: string[] = [];
  const req: Record<string, string> = {};

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { email: `test-coverage-lib-${SUFFIX}@example.com`, name: "Coverage Lib", role: "COMPLIANCE_MANAGER" },
    });
    userId = user.id;
    const [mixed, empty] = await Promise.all([
      prisma.framework.create({ data: { name: `Test Coverage Mixed ${SUFFIX}`, version: "1" } }),
      prisma.framework.create({ data: { name: `Test Coverage Empty ${SUFFIX}`, version: "1" } }),
    ]);
    mixedId = mixed.id;
    emptyId = empty.id;

    for (const n of [1, 2]) {
      const control = await prisma.control.create({
        data: {
          code: `TEST-COV-${SUFFIX}-${n}`,
          title: `Coverage control ${n}`,
          description: "d",
          category: "Test",
          applicability: "ORGANIZATIONAL",
          originFrameworkId: n === 2 ? mixedId : null,
        },
      });
      controlIds.push(control.id);
    }

    // full (Full), both (Partial + Full), partial (Partial only), unmapped,
    // accepted (Partial + accepted), stale (Full + a leftover acceptance)
    const codes = ["full", "both", "partial", "unmapped", "accepted", "stale"];
    for (const code of codes) {
      const requirement = await prisma.requirement.create({
        data: {
          frameworkId: mixedId,
          code,
          section: code === "full" || code === "both" ? "Section A" : "Section B",
          title: `T ${code}`,
          text: "x",
        },
      });
      req[code] = requirement.id;
    }
    const map = (code: string, control: number, coverage: "FULL" | "PARTIAL") =>
      prisma.controlMapping.create({ data: { requirementId: req[code], controlId: controlIds[control], coverage } });
    await map("full", 0, "FULL");
    await map("both", 0, "PARTIAL");
    await map("both", 1, "FULL");
    await map("partial", 0, "PARTIAL");
    await map("accepted", 0, "PARTIAL");
    await map("stale", 0, "FULL");
    const acceptance = { gapAcceptedAt: new Date(), gapAcceptedById: userId, gapJustification: "Out of scope" };
    await prisma.requirement.update({ where: { id: req.accepted }, data: acceptance });
    await prisma.requirement.update({ where: { id: req.stale }, data: acceptance });
  });

  afterAll(async () => {
    await prisma.control.deleteMany({ where: { id: { in: controlIds } } });
    await prisma.framework.deleteMany({ where: { id: { in: [mixedId, emptyId] } } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("derives each Requirement's state and the header counts", async () => {
    const { summary, requirements } = await loadFrameworkCoverage(mixedId);
    const stateOf = Object.fromEntries(requirements.map((r) => [r.code, r.state]));
    expect(stateOf).toEqual({
      full: "COVERED",
      both: "COVERED",
      partial: "GAP",
      unmapped: "GAP",
      accepted: "ACCEPTED_GAP",
      stale: "COVERED",
    });
    expect(summary).toEqual({ total: 6, covered: 3, gaps: 2, accepted: 1 });
  });

  it("carries the mapped Controls with their Coverage and origin Framework, and the acceptance details", async () => {
    const { requirements } = await loadFrameworkCoverage(mixedId);
    const both = requirements.find((r) => r.code === "both")!;
    expect(both.mappings.map((m) => [m.control.code, m.coverage])).toEqual([
      [`TEST-COV-${SUFFIX}-1`, "PARTIAL"],
      [`TEST-COV-${SUFFIX}-2`, "FULL"],
    ]);
    expect(both.mappings[0].control.originFramework).toBeNull();
    expect(both.mappings[1].control.originFramework).toMatchObject({ id: mixedId });
    const accepted = requirements.find((r) => r.code === "accepted")!;
    expect(accepted).toMatchObject({ gapJustification: "Out of scope", gapAcceptedBy: { id: userId } });
    expect(accepted.gapAcceptedAt).toEqual(expect.any(String));
  });

  it("orders Requirements by section, then code", async () => {
    const { requirements } = await loadFrameworkCoverage(mixedId);
    expect(requirements.map((r) => r.code)).toEqual(["both", "full", "accepted", "partial", "stale", "unmapped"]);
  });

  it("summarizes several Frameworks at once; a Framework without Requirements is all zeros", async () => {
    const summaries = await loadCoverageSummaries([mixedId, emptyId]);
    expect(summaries[mixedId]).toEqual({ total: 6, covered: 3, gaps: 2, accepted: 1 });
    expect(summaries[emptyId]).toEqual({ total: 0, covered: 0, gaps: 0, accepted: 0 });
  });

  it("clearGapAcceptance clears all three fields, and is a no-op for a Requirement that wasn't accepted", async () => {
    await clearGapAcceptance(prisma, req.stale);
    await clearGapAcceptance(prisma, req.unmapped);
    const stale = await prisma.requirement.findUnique({ where: { id: req.stale } });
    expect(stale).toMatchObject({ gapAcceptedAt: null, gapAcceptedById: null, gapJustification: null });
    const untouched = await prisma.requirement.findUnique({ where: { id: req.accepted } });
    expect(untouched?.gapAcceptedAt).not.toBeNull();
  });

  it("the migrated ISO/IEC 27001:2022 Framework is fully covered (when the base Framework is seeded)", async () => {
    const iso = await prisma.framework.findFirst({ where: { name: "ISO/IEC 27001", version: "2022" } });
    if (!iso) return; // CI's database is migrated but not seeded
    const { summary } = await loadFrameworkCoverage(iso.id);
    if (summary.total === 0) return;
    expect(summary).toEqual({ total: summary.total, covered: summary.total, gaps: 0, accepted: 0 });
  });
});
