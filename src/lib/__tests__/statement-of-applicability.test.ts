import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { mapControlsToFramework } from "@/test/framework-fixtures";
import { setupProviderFixtures } from "@/test/provider-fixtures";
import { loadStatementOfApplicability } from "../statement-of-applicability";

/**
 * The Statement of Applicability loader against real Postgres (#145). Fixtures
 * only: the assertions look up this file's own Controls by id, because a seeded
 * database has 118 more and CI's has none. The fixture Controls are all mapped to
 * a fixture Published Framework that only the fixture Systems declare, so no other
 * test file's System (nor a seeded one) is affected by them.
 */

describe("loadStatementOfApplicability (#145)", () => {
  const ctx = setupProviderFixtures("SOA");
  const draftFrameworkIds: string[] = [];

  afterAll(async () => {
    await prisma.requirement.deleteMany({ where: { frameworkId: { in: draftFrameworkIds } } });
    await prisma.framework.deleteMany({ where: { id: { in: draftFrameworkIds } } });
  });

  async function rowOf(controlId: string) {
    const rows = await loadStatementOfApplicability();
    const matches = rows.filter((row) => row.controlId === controlId);
    expect(matches).toHaveLength(1);
    return matches[0];
  }

  it("lists every Control exactly once, ordered by code, and shows no inclusion before a System is declared", async () => {
    const rows = await loadStatementOfApplicability();
    expect(new Set(rows.map((row) => row.controlId)).size).toBe(rows.length);
    const fixtureIds = Object.values(ctx.controls).map((control) => control.id);
    for (const id of fixtureIds) expect(rows.filter((row) => row.controlId === id)).toHaveLength(1);

    const codes = rows.map((row) => row.code);
    expect(codes).toEqual([...codes].sort((a, b) => a.localeCompare(b, "en", { numeric: true })));

    // No fixture System exists yet: the Per-System Controls apply to nothing; the Organization's Controls are mapped to a Published Framework.
    for (const key of ["perSystem", "stale", "elsewhere"] as const) {
      expect(await rowOf(ctx.controls[key].id), key).toMatchObject({
        included: false,
        inclusionJustification: "",
        exclusionJustification: null,
        justificationMissing: true,
        organizationStatus: null,
        systemRollup: null,
      });
    }
    expect(await rowOf(ctx.controls.organizational.id)).toMatchObject({ included: true, organizationStatus: "NOT_STARTED", systemRollup: null });
    expect(await rowOf(ctx.controls.both.id)).toMatchObject({ included: true, organizationStatus: "NOT_STARTED" });
  });

  it("includes an excluded Control once a System it applies to is declared, even a Draft one (nothing stored)", async () => {
    const framework = await prisma.framework.findUniqueOrThrow({ where: { id: ctx.frameworkId } });
    expect((await rowOf(ctx.controls.perSystem.id)).included).toBe(false);

    await ctx.makeSystem({ status: "DRAFT" });

    const row = await rowOf(ctx.controls.perSystem.id);
    expect(row).toMatchObject({ included: true, justificationMissing: false, appliesToSystemCount: 1 });
    expect(row.inclusionJustification).toMatch(new RegExp(`^${framework.name}:1 TEST-FX-`));
    expect(row.systemRollup).toMatchObject({ total: 1, counts: { NOT_STARTED: 1 } });
    // The Facet nobody declares keeps its Control excluded.
    expect((await rowOf(ctx.controls.elsewhere.id)).included).toBe(false);
  });

  it("rolls a Per-System Control up by effective status, a status inherited from a Provider included", async () => {
    const provider = await ctx.makeSystem({ isProvider: true, name: `Test SOA Provider ${ctx.suffix}` });
    const dependent = await ctx.makeSystem({ name: `Test SOA Dependent ${ctx.suffix}` });
    await ctx.assess(provider, ctx.controls.stale.id, "FULFILLED");
    await ctx.offer(provider, ctx.controls.stale.id);
    await ctx.depend(dependent, provider);
    await ctx.assess(dependent, ctx.controls.stale.id, "IN_PROGRESS", null);

    const row = await rowOf(ctx.controls.stale.id);
    // The Draft System from the previous test (untouched), the Provider (own Fulfilled) and the dependent (Fulfilled from the Provider).
    expect(row.systemRollup).toEqual({
      total: 3,
      counts: { NOT_STARTED: 1, IN_PROGRESS: 0, FULFILLED: 2, NOT_APPLICABLE: 0, WAIVED: 0 },
    });
    expect(row.organizationStatus).toBeNull();
  });

  it("shows the Organization's status for an Organizational Control and its inheritance for a Both Control", async () => {
    await prisma.organizationControlImplementation.upsert({
      where: { controlId: ctx.controls.organizational.id },
      create: { controlId: ctx.controls.organizational.id, status: "IN_PROGRESS" },
      update: { status: "IN_PROGRESS" },
    });
    await prisma.organizationControlImplementation.upsert({
      where: { controlId: ctx.controls.both.id },
      create: { controlId: ctx.controls.both.id, status: "FULFILLED" },
      update: { status: "FULFILLED" },
    });
    const systemCount = ctx.systemIds.length;

    expect(await rowOf(ctx.controls.organizational.id)).toMatchObject({ organizationStatus: "IN_PROGRESS", systemRollup: null });
    const both = await rowOf(ctx.controls.both.id);
    expect(both.organizationStatus).toBe("FULFILLED");
    // Every System the Both Control applies to inherits the Organization's Fulfilled while it has no own status.
    expect(both.systemRollup).toMatchObject({ total: systemCount, counts: { FULFILLED: systemCount } });
  });

  it("leaves a Draft Framework's mapping out of the justification and never lets it include a Control", async () => {
    const draft = await prisma.framework.create({
      data: { name: `Test SOA Secret Draft ${ctx.suffix}`, version: "9", status: "DRAFT" },
    });
    draftFrameworkIds.push(draft.id);
    const control = await prisma.control.create({
      data: {
        code: `TEST-SOA-draftonly-${ctx.suffix}`,
        title: "Test SOA draft only",
        description: "d",
        category: "Test",
        applicability: "ORGANIZATIONAL",
      },
    });
    try {
      await mapControlsToFramework(draft.id, [control.id, ctx.controls.organizational.id]);

      expect(await rowOf(control.id)).toMatchObject({ included: false, inclusionJustification: "", justificationMissing: true });
      const mixed = await rowOf(ctx.controls.organizational.id);
      expect(mixed.included).toBe(true);
      expect(mixed.inclusionJustification).not.toContain(draft.name);
    } finally {
      await prisma.control.delete({ where: { id: control.id } });
    }
  });
});
