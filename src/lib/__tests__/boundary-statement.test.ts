import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { loadBoundaryStatement } from "@/lib/boundary-statement";
import { cleanupFixtureRequirements, createFixtureFramework, mapControlsToFramework } from "@/test/framework-fixtures";

/**
 * The per-Boundary Statement of Applicability loader (#420) against real Postgres. Fixtures only, named `Test #420 ...`: a non-base
 * Framework, Controls scoped to fixture Facets, Systems in each state. Nothing touches the base Framework.
 */
const suffix = `${process.pid}-${Date.now()}`;
const N = (label: string) => `Test #420 ${label} ${suffix}`;

describe("loadBoundaryStatement (#420)", { timeout: 90_000 }, () => {
  const users = {} as Record<"admin" | "cm" | "viewer" | "owner" | "boundaryOwner", { id: string; role: UserRole }>;
  const facets: Record<"a" | "b" | "c" | "d", string> = { a: "", b: "", c: "", d: "" };
  let fw: string;
  const req = {} as Record<"a" | "b" | "org" | "unmapped" | "never" | "draftOnly", string>;
  const controlIds: string[] = [];
  const systemIds: string[] = [];
  const boundaryIds: string[] = [];
  const sys = {} as Record<"onboarded" | "approved" | "draft" | "rejected", string>;
  let boundary: string;
  let draftOnlyBoundary: string;

  const makeControl = async (code: string, applicability: "PER_SYSTEM" | "ORGANIZATIONAL", facet?: string) => {
    const control = await prisma.control.create({
      data: { code: `T420-${code}-${suffix}`, title: N(code), description: "d", category: "Test", applicability, ...(facet && { deploymentFacets: { connect: [{ id: facet }] } }) },
    });
    controlIds.push(control.id);
    return control.id;
  };
  const makeSystem = async (label: string, status: "DRAFT" | "APPROVED" | "ONBOARDED" | "REJECTED", facetIds: string[], closed = false) => {
    const system = await prisma.system.create({
      data: { name: N(label), ownerId: users.owner.id, status, evaluationClosedAt: closed ? new Date() : null, deploymentFacets: { connect: facetIds.map((id) => ({ id })) } },
    });
    systemIds.push(system.id);
    return system.id;
  };
  const rowOf = (statement: Awaited<ReturnType<typeof loadBoundaryStatement>>, requirementId: string) => {
    const rows = statement!.sections.flatMap((section) => section.rows).filter((row) => row.requirementId === requirementId);
    expect(rows).toHaveLength(1);
    return rows[0];
  };

  beforeAll(async () => {
    for (const [key, role] of [["admin", "ADMIN"], ["cm", "COMPLIANCE_MANAGER"], ["viewer", "VIEWER"], ["owner", "SYSTEM_OWNER"], ["boundaryOwner", "SYSTEM_OWNER"]] as const) {
      const row = await prisma.user.create({ data: { email: `test-420-${key}-${suffix}@example.com`, name: N(key), role } });
      users[key] = { id: row.id, role };
    }
    for (const key of ["a", "b", "c", "d"] as const) facets[key] = (await prisma.deploymentFacet.create({ data: { name: N(`Facet ${key}`) } })).id;
    fw = (await createFixtureFramework("420")).id;
    const cA = await makeControl("A", "PER_SYSTEM", facets.a);
    const cB = await makeControl("B", "PER_SYSTEM", facets.b);
    const cOrg = await makeControl("ORG", "ORGANIZATIONAL");
    const cNever = await makeControl("NEVER", "PER_SYSTEM", facets.c);
    const cDraftOnly = await makeControl("DRAFTONLY", "PER_SYSTEM", facets.d);
    req.a = await mapControlsToFramework(fw, [cA]);
    req.b = await mapControlsToFramework(fw, [cB]);
    req.org = await mapControlsToFramework(fw, [cOrg]);
    req.never = await mapControlsToFramework(fw, [cNever]);
    req.draftOnly = await mapControlsToFramework(fw, [cDraftOnly]);
    // No Control Mapping at all: Not Met wherever it is judged, so included when a System is counted.
    req.unmapped = (await prisma.requirement.create({ data: { frameworkId: fw, code: `T420-UNMAPPED-${suffix}`, section: "Test", title: N("unmapped"), text: "t" } })).id;
    await prisma.organizationControlImplementation.create({ data: { controlId: cOrg, status: "FULFILLED" } });

    sys.onboarded = await makeSystem("onboarded", "ONBOARDED", [facets.a, facets.b]);
    sys.approved = await makeSystem("approved", "APPROVED", [facets.a]);
    sys.draft = await makeSystem("draft", "DRAFT", [facets.b, facets.d]);
    sys.rejected = await makeSystem("rejected", "REJECTED", [facets.a, facets.c], true);
    // A fulfilled on the Onboarded System only: Met on 1 of 2 Systems the Requirement applies to.
    await prisma.controlAssessment.create({ data: { systemId: sys.onboarded, controlId: cA, status: "FULFILLED" } });
    await prisma.controlAssessment.create({ data: { systemId: sys.onboarded, controlId: cB, status: "FULFILLED" } });

    boundary = (
      await prisma.complianceBoundary.create({
        data: {
          name: N("boundary"),
          boundaryOwnerId: users.boundaryOwner.id,
          frameworks: { create: [{ frameworkId: fw }] },
          systems: { create: Object.values(sys).map((systemId) => ({ systemId })) },
        },
      })
    ).id;
    // Members: only a Draft System, so nothing is counted.
    draftOnlyBoundary = (
      await prisma.complianceBoundary.create({ data: { name: N("only draft"), frameworks: { create: [{ frameworkId: fw }] }, systems: { create: [{ systemId: sys.draft }] } } })
    ).id;
    boundaryIds.push(boundary, draftOnlyBoundary);
    await prisma.boundaryExclusionJustification.create({ data: { boundaryId: boundary, requirementId: req.never, text: "Not in this scope" } });
    // A kept text on an included Requirement: it is stored but not presented as a reason.
    await prisma.boundaryExclusionJustification.create({ data: { boundaryId: boundary, requirementId: req.a, text: "Stale text" } });
  }, 60_000);

  afterAll(async () => {
    await prisma.complianceBoundary.deleteMany({ where: { id: { in: boundaryIds } } });
    await prisma.system.deleteMany({ where: { id: { in: systemIds } } });
    await cleanupFixtureRequirements();
    await prisma.organizationControlImplementation.deleteMany({ where: { controlId: { in: controlIds } } });
    await prisma.control.deleteMany({ where: { id: { in: controlIds } } });
    await prisma.deploymentFacet.deleteMany({ where: { id: { in: Object.values(facets) } } });
    await prisma.user.deleteMany({ where: { id: { in: Object.values(users).map((u) => u.id) } } });
  }, 60_000);

  it("returns null for an unknown Boundary", async () => {
    expect(await loadBoundaryStatement("nope", users.admin)).toBeNull();
  });

  it("counts Onboarded and Approved members, and lists the rest uncounted", async () => {
    const statement = (await loadBoundaryStatement(boundary, users.admin))!;
    expect(statement.countedSystems.map((s) => s.id).sort()).toEqual([sys.onboarded, sys.approved].sort());
    expect(statement.notYetOperating.map((s) => s.id)).toEqual([sys.draft]);
    expect(statement.closed.map((s) => s.id)).toEqual([sys.rejected]);
    expect(statement.sections.map((section) => section.framework.id)).toEqual([fw]);
  });

  it("includes a Requirement that applies to a counted System, and takes the worst status with Met on x of y", async () => {
    const statement = await loadBoundaryStatement(boundary, users.admin);
    // A: applies to the Onboarded (Fulfilled) and the Approved (not started) Systems.
    expect(rowOf(statement, req.a)).toMatchObject({ included: true, worstStatus: "NOT_MET", metCount: 1, appliesToCount: 2, justification: null, justificationMissing: false });
    // B: only the Onboarded System has Facet b among the counted ones; the Draft System with it is not counted.
    expect(rowOf(statement, req.b)).toMatchObject({ included: true, worstStatus: "MET", metCount: 1, appliesToCount: 1 });
    expect(rowOf(statement, req.unmapped)).toMatchObject({ included: true, worstStatus: "NOT_MET", appliesToCount: 2 });
  });

  it("includes a Requirement met by an Organizational Control, with the Organization's status", async () => {
    const row = rowOf(await loadBoundaryStatement(boundary, users.admin), req.org);
    expect(row).toMatchObject({ included: true, organizationOnly: true, organizationStatus: "MET", worstStatus: "MET", metCount: 2, appliesToCount: 2 });
  });

  it("excludes a Requirement no counted System needs, even one only a not-yet-operating System has, and shows the justification", async () => {
    const statement = await loadBoundaryStatement(boundary, users.admin);
    expect(rowOf(statement, req.never)).toMatchObject({ included: false, worstStatus: null, justification: "Not in this scope", justificationMissing: false });
    expect(rowOf(statement, req.draftOnly)).toMatchObject({ included: false, worstStatus: null, justification: null, justificationMissing: true });
  });

  it("with no counted System, includes only what Organizational Controls meet", async () => {
    const statement = (await loadBoundaryStatement(draftOnlyBoundary, users.admin))!;
    expect(statement.countedSystems).toEqual([]);
    expect(statement.notYetOperating.map((s) => s.id)).toEqual([sys.draft]);
    expect(rowOf(statement, req.org)).toMatchObject({ included: true, worstStatus: "MET", appliesToCount: 0 });
    for (const key of ["a", "b", "never", "draftOnly"] as const) expect(rowOf(statement, req[key]).included, key).toBe(false);
    // Not Met by default stays out too: an unmapped Requirement applies to no counted System.
    expect(rowOf(statement, req.unmapped).included).toBe(false);
  });

  it("names only the counted Systems the acting user may see, and still counts the others", async () => {
    // A Viewer sees Onboarded Systems only: the Approved one counts but is not named.
    const statement = (await loadBoundaryStatement(boundary, users.viewer))!;
    expect(statement.systems.map((s) => s.id)).toEqual([sys.onboarded]);
    const row = rowOf(statement, req.a);
    expect(row.appliesToCount).toBe(2);
    expect(row.hiddenSystemCount).toBe(1);
    expect(row.systemStatuses).toEqual([[0, "MET"]]);
    // Every role sees the members' names in the counted list (as on the Boundary page); only the drill-down is visibility-bound.
    expect(statement.countedSystems.map((s) => s.name)).toContain(N("approved"));
    expect(statement.systems.map((s) => s.name)).not.toContain(N("approved"));
    // The Admin sees both.
    const full = (await loadBoundaryStatement(boundary, users.admin))!;
    expect(rowOf(full, req.a).hiddenSystemCount).toBe(0);
    expect(rowOf(full, req.a).systemStatuses).toHaveLength(2);
  });

  it("says who can edit: the Boundary Owner, a Compliance Manager and an Admin", async () => {
    const can = async (key: keyof typeof users) => (await loadBoundaryStatement(boundary, users[key]))!.canEdit;
    expect([await can("admin"), await can("cm"), await can("boundaryOwner")]).toEqual([true, true, true]);
    expect([await can("viewer"), await can("owner")]).toEqual([false, false]);
  });

  it("gives a retired Boundary no statement", async () => {
    const retired = await prisma.complianceBoundary.create({ data: { name: N("retired"), retiredAt: new Date(), frameworks: { create: [{ frameworkId: fw }] }, systems: { create: [{ systemId: sys.onboarded }] } } });
    boundaryIds.push(retired.id);
    const statement = (await loadBoundaryStatement(retired.id, users.admin))!;
    expect(statement.boundary.retired).toBe(true);
    expect(statement.sections).toEqual([]);
    expect(statement.canEdit).toBe(false);
  });
});
