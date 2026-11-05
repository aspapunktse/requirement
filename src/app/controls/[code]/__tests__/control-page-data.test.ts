import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { effectiveSourceLabel } from "@/lib/effective-status";
import { loadEffectiveStatus, toOwnAssessment } from "@/lib/effective-status-data";
import { cleanupFixtureRequirements, createFixtureFramework, mapControlsToFramework } from "@/test/framework-fixtures";
import { setupProviderFixtures } from "@/test/provider-fixtures";
import { decodeControlCode, loadControlPageView } from "../control-page-data";

/**
 * The Control page's server side (#314), against real Postgres with its own `Test 314` fixtures (CI's database is
 * migrated but not seeded). The Per-System and Both fixtures are scoped to a fixture Facet and mapped to a fixture
 * Published Framework only the fixture Systems declare, so their reach is exactly those Systems.
 */
describe("loadControlPageView (#314)", { timeout: 30_000 }, () => {
  const f = setupProviderFixtures("314");
  const suffix = `${process.pid}-${Date.now()}`;
  let draftFrameworkId = "";
  let draftName = "";
  let draftOnlyId = "";
  let draftOnlyCode = "";
  let sysA = "";
  let sysB = "";
  let sysP = "";
  let secondFrameworkId = "";

  const ROLE: Record<string, UserRole> = { owner: "SYSTEM_OWNER", otherOwner: "SYSTEM_OWNER", admin: "ADMIN", complianceManager: "COMPLIANCE_MANAGER", viewer: "VIEWER" };
  const as = (key: keyof typeof ROLE) => ({ id: f.users[key as keyof typeof f.users], name: `Test 314 ${key}`, role: ROLE[key] });

  beforeAll(async () => {
    const draft = await prisma.framework.create({ data: { name: `Test 314 Draft Framework ${suffix}`, version: "9", status: "DRAFT" } });
    draftFrameworkId = draft.id;
    draftName = draft.name;
    // A Control mapped only to the Draft Framework, with it as its origin.
    const only = await prisma.control.create({
      data: { code: `TEST-314-DRAFTONLY-${suffix}`, title: "Test 314 draft only", description: "d", category: "Test", applicability: "ORGANIZATIONAL", originFrameworkId: draftFrameworkId },
    });
    draftOnlyId = only.id;
    draftOnlyCode = only.code;
    await prisma.requirement.create({
      data: { frameworkId: draftFrameworkId, code: "T314.1", section: "T", title: "Draft requirement", text: "t", mappings: { create: { controlId: only.id, coverage: "FULL" } } },
    });
    // The Both Control also maps into the Draft, and Partially into a second Published Framework.
    await prisma.requirement.create({
      data: { frameworkId: draftFrameworkId, code: "T314.2", section: "T", title: "Draft requirement 2", text: "t", mappings: { create: { controlId: f.controls.both.id, coverage: "PARTIAL" } } },
    });
    const second = await createFixtureFramework("314 second");
    secondFrameworkId = second.id;
    await prisma.requirement.create({
      data: { frameworkId: second.id, code: "T314.3", section: "T", title: "Second requirement", text: "t", mappings: { create: { controlId: f.controls.both.id, coverage: "PARTIAL" } } },
    });
    await mapControlsToFramework(second.id, [f.controls.organizational.id]);

    await prisma.organizationControlImplementation.create({
      data: { controlId: f.controls.both.id, status: "FULFILLED", description: "Done by the Organization.", updatedById: f.users.admin },
    });

    sysA = await f.makeSystem({ ownerId: f.users.owner });
    sysB = await f.makeSystem({ ownerId: f.users.otherOwner, status: "DRAFT" });
    sysP = await f.makeSystem({ ownerId: f.users.owner, isProvider: true });
    await f.offer(sysP, f.controls.perSystem.id, "FULL");
    await f.assess(sysP, f.controls.perSystem.id, "FULFILLED");
    await f.depend(sysA, sysP);
    await f.assess(sysB, f.controls.perSystem.id, "IN_PROGRESS");
  });

  afterAll(async () => {
    await cleanupFixtureRequirements();
    await prisma.control.deleteMany({ where: { id: draftOnlyId } });
    await prisma.requirement.deleteMany({ where: { frameworkId: draftFrameworkId } });
    await prisma.framework.deleteMany({ where: { id: draftFrameworkId } });
  });

  it("is null for a code no Control has", async () => {
    expect(await loadControlPageView(as("admin"), `NO-SUCH-${suffix}`)).toBeNull();
  });

  it("decodes a percent-encoded code", () => {
    expect(decodeControlCode("A.5.1")).toBe("A.5.1");
    expect(decodeControlCode("SEC%20042")).toBe("SEC 042");
    expect(decodeControlCode("%E0%A4%A")).toBe("%E0%A4%A");
  });

  it("hides Draft Frameworks from a role that can't see Drafts, but not the Control", async () => {
    for (const role of ["owner", "viewer"] as const) {
      const view = await loadControlPageView(as(role), f.controls.both.code);
      expect(view?.control.mappings.map((m) => m.requirementCode)).not.toContain("T314.2");
      expect(view?.control.mappings.map((m) => m.requirementCode)).toContain("T314.3");
      expect(view?.control.mappings.some((m) => m.draft)).toBe(false);
      expect(JSON.stringify(view)).not.toContain(draftName);
      expect(JSON.stringify(view)).not.toContain(draftFrameworkId);
    }
  });

  it("reads a Supplementary Control with a Draft origin as plain Supplementary, and as not mapped, for those roles", async () => {
    const view = await loadControlPageView(as("viewer"), draftOnlyCode);
    expect(view?.control.title).toBe("Test 314 draft only");
    expect(view?.control.source).toMatchObject({ key: "sup", label: "Supplementary", kind: "supplementary", draft: false });
    expect(view?.control.mappings).toEqual([]);
    expect(JSON.stringify(view)).not.toContain(draftName);
  });

  it("shows a Compliance Manager and an Admin the Draft origin and mappings, marked", async () => {
    for (const role of ["complianceManager", "admin"] as const) {
      const view = await loadControlPageView(as(role), draftOnlyCode);
      expect(view?.canEdit).toBe(true);
      expect(view?.control.source.draft).toBe(true);
      expect(view?.control.source.label).toContain(draftName);
      expect(view?.control.mappings).toHaveLength(1);
      expect(view?.control.mappings[0].draft).toBe(true);
    }
    expect((await loadControlPageView(as("viewer"), draftOnlyCode))?.canEdit).toBe(false);
  });

  it("lists the Requirements with their Coverage, Draft ones only for those who see Drafts", async () => {
    const curator = await loadControlPageView(as("admin"), f.controls.both.code);
    const coverage = curator!.control.mappings.map((m) => [m.requirementCode, m.coverage, m.draft]);
    expect(coverage).toEqual(expect.arrayContaining([["T314.2", "PARTIAL", true], ["T314.3", "PARTIAL", false]]));
    const fixtureFull = curator!.control.mappings.filter((m) => m.coverage === "FULL");
    expect(fixtureFull.length).toBeGreaterThanOrEqual(1);
    const viewer = await loadControlPageView(as("viewer"), f.controls.both.code);
    expect(viewer!.control.mappings.length).toBe(curator!.control.mappings.length - 1);
  });

  it("carries the Organization implementation of a Both Control, and nothing for a Per-System one", async () => {
    const both = await loadControlPageView(as("viewer"), f.controls.both.code);
    expect(both?.organization).toMatchObject({ status: "FULFILLED", description: "Done by the Organization.", updatedByName: "Test 314 admin" });
    expect(both?.organization?.updatedOn).toMatch(/\d{4}$/);
    const perSystem = await loadControlPageView(as("viewer"), f.controls.perSystem.code);
    expect(perSystem?.organization).toBeNull();
    expect(perSystem?.control.orgStatus).toBeNull();
  });

  it("reads Not Started, never updated, for an Organizational Control with no implementation, and has no Systems", async () => {
    const view = await loadControlPageView(as("viewer"), f.controls.organizational.code);
    expect(view?.organization).toEqual({ status: "NOT_STARTED", description: null, updatedOn: null, updatedByName: null });
    expect(view?.systems).toBeNull();
  });

  it("counts every System the Control applies to but lists only those the user can see", async () => {
    const owner = await loadControlPageView(as("owner"), f.controls.perSystem.code);
    expect(owner?.systems?.total).toBe(3);
    expect(owner?.control.systemCount).toBe(3);
    expect(owner?.systems?.list.map((s) => s.id).sort()).toEqual([sysA, sysP].sort());
    expect(Object.values(owner!.systems!.counts).reduce((a, b) => a + b, 0)).toBe(3);
    expect(owner?.systems?.counts.IN_PROGRESS).toBe(1);

    const admin = await loadControlPageView(as("admin"), f.controls.perSystem.code);
    expect(admin?.systems?.list.map((s) => s.id).sort()).toEqual([sysA, sysB, sysP].sort());
    const other = await loadControlPageView(as("otherOwner"), f.controls.perSystem.code);
    expect(other?.systems?.list.map((s) => s.id).sort()).toEqual([sysA, sysB, sysP].sort());
  });

  it("gives each System the effective status and source the System page shows, Provider and Organization included", async () => {
    for (const control of [f.controls.perSystem, f.controls.both]) {
      const view = await loadControlPageView(as("admin"), control.code);
      expect(view?.systems?.list.length).toBe(3);
      for (const row of view!.systems!.list) {
        const own = await prisma.controlAssessment.findUnique({ where: { systemId_controlId: { systemId: row.id, controlId: control.id } } });
        const applicability = control === f.controls.both ? "BOTH" : "PER_SYSTEM";
        const effective = await loadEffectiveStatus(row.id, { id: control.id, applicability }, own ? toOwnAssessment(own) : null);
        expect(row.status).toBe(effective.status);
        expect(row.sourceLabel).toBe(effectiveSourceLabel(effective));
      }
    }
    const perSystem = await loadControlPageView(as("admin"), f.controls.perSystem.code);
    const a = perSystem!.systems!.list.find((s) => s.id === sysA)!;
    expect(a.status).toBe("FULFILLED");
    expect(a.sourceLabel).toMatch(/^Inherited from Provider .*: Full$/);
    expect(perSystem!.systems!.list.find((s) => s.id === sysB)).toMatchObject({ status: "IN_PROGRESS", sourceLabel: "System-specific" });

    const both = await loadControlPageView(as("admin"), f.controls.both.code);
    expect(both!.systems!.list.find((s) => s.id === sysA)).toMatchObject({ status: "FULFILLED", sourceLabel: "Inherited from Organization" });
  });

  it("shares the Systems of a Shared Offering's half-done state with the System page's wording", async () => {
    await prisma.controlOffering.create({ data: { providerId: sysP, controlId: f.controls.both.id, type: "SHARED", customerResponsibility: "Patch it." } });
    await f.assess(sysB, f.controls.both.id, "FULFILLED");
    const view = await loadControlPageView(as("admin"), f.controls.both.code);
    const b = view!.systems!.list.find((s) => s.id === sysB)!;
    const own = await prisma.controlAssessment.findUnique({ where: { systemId_controlId: { systemId: sysB, controlId: f.controls.both.id } } });
    const effective = await loadEffectiveStatus(sysB, { id: f.controls.both.id, applicability: "BOTH" }, toOwnAssessment(own!));
    expect(b.status).toBe(effective.status);
    expect(b.sourceLabel).toBe(effectiveSourceLabel(effective));
    await prisma.controlOffering.deleteMany({ where: { providerId: sysP, controlId: f.controls.both.id } });
  });

  it("lists no System for a role that sees none, and says how many exist", async () => {
    const stranger = await loadControlPageView({ id: f.users.viewer, name: "Test 314 viewer", role: "VIEWER" }, f.controls.perSystem.code);
    // A Viewer sees Onboarded Systems only: B is a Draft.
    expect(stranger?.systems?.total).toBe(3);
    expect(stranger?.systems?.list.map((s) => s.id)).not.toContain(sysB);
    expect(secondFrameworkId).not.toBe("");
  });
});
