import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { frameworkLabel } from "@/lib/framework-label";
import { cleanupFixtureRequirements, createFixtureFramework, getBaseFramework, mapControlsToFramework } from "@/test/framework-fixtures";
import { canEditControlLibrary } from "@/lib/control-library";
import { loadControlLibraryView } from "../library-data";

const ROLES: UserRole[] = ["ADMIN", "COMPLIANCE_MANAGER", "SYSTEM_OWNER", "RISK_OWNER", "REVIEWER", "BUSINESS_RISK_OWNER", "VIEWER", "INTERNAL_AUDITOR"];
const CURATORS: UserRole[] = ["ADMIN", "COMPLIANCE_MANAGER"];

/**
 * The Control Library page's server side (#313), against real Postgres with its own `TEST-313-...` fixtures (CI's
 * database is migrated but not seeded; a seeded one has 100+ more Controls, so every assertion looks up the fixture
 * rows). The Per-System and Both fixtures are scoped to a fixture Facet and mapped to a fixture Published
 * Framework only the fixture Systems declare, so their reach is exactly those Systems.
 */
describe("loadControlLibraryView (#313)", () => {
  const suffix = `${process.pid}-${Date.now()}`;
  const code = (name: string) => `TEST-313-${name}-${suffix}`;
  const ids: Record<string, string> = {};
  const controlIds: string[] = [];
  const systemIds: string[] = [];
  let publishedName = "";
  let draftName = "";
  let draftFrameworkId = "";
  let facetId = "";
  let ownerId = "";
  let auditorId = "";

  const as = (role: UserRole) => ({ id: `user-${role}`, name: `Test 313 ${role}`, role });
  const find = async (role: UserRole, name: string) => {
    const view = await loadControlLibraryView(as(role));
    const row = view.rows.find((candidate) => candidate.code === code(name));
    if (!row) throw new Error(`${name} is missing from the view`);
    return { view, row };
  };

  beforeAll(async () => {
    const published = await createFixtureFramework("313 published");
    publishedName = published.name;
    const draft = await prisma.framework.create({ data: { name: `Test 313 Draft Framework ${suffix}`, version: "9", status: "DRAFT" } });
    draftFrameworkId = draft.id;
    draftName = draft.name;
    ownerId = (await prisma.user.create({ data: { email: `test-313-owner-${suffix}@example.com`, name: `Test 313 Owner ${suffix}`, role: "SYSTEM_OWNER" } })).id;
    auditorId = (await prisma.user.create({ data: { email: `test-313-auditor-${suffix}@example.com`, name: `Test 313 Auditor ${suffix}`, role: "INTERNAL_AUDITOR" } })).id;
    facetId = (await prisma.deploymentFacet.create({ data: { name: `Test 313 Facet ${suffix}` } })).id;

    const make = async (name: string, extra: object = {}) => {
      const control = await prisma.control.create({
        data: { code: code(name), title: `Test 313 ${name}`, description: "d", category: "Test 313", applicability: "ORGANIZATIONAL", ...extra },
      });
      controlIds.push(control.id);
      ids[name] = control.id;
      return control.id;
    };
    // The base Control: no origin. Fulfilled, owned.
    await make("BASE", { ownerId, examples: ["an example"], intent: "why" });
    await make("SUP", { originFrameworkId: published.id });
    await make("DRAFTORIGIN", { originFrameworkId: draftFrameworkId });
    const mapped = await make("MAPPED");
    await make("PERSYS", { applicability: "PER_SYSTEM", deploymentFacets: { connect: [{ id: facetId }] } });
    await make("BOTH", { applicability: "BOTH", deploymentFacets: { connect: [{ id: facetId }] } });
    await prisma.organizationControlImplementation.create({ data: { controlId: ids.BASE, status: "FULFILLED" } });
    // Mapped to the Published Framework and, for the Draft-visibility check, to the Draft one too.
    await mapControlsToFramework(published.id, [mapped, ids.PERSYS, ids.BOTH]);
    await mapControlsToFramework(draftFrameworkId, [mapped]);

    // Two Systems the Per-System and Both Controls reach (the Facet and the Framework in scope), one they do not (no Facet).
    for (const withFacet of [true, true, false]) {
      const system = await prisma.system.create({
        data: {
          name: `Test 313 System ${suffix}-${systemIds.length}`,
          ownerId,
          status: "ONBOARDED",
          sensitivityLevel: 3,
          deploymentFacets: withFacet ? { connect: [{ id: facetId }] } : undefined,
          frameworkScopes: { connect: [{ id: published.id }] },
        },
      });
      systemIds.push(system.id);
    }
  });

  afterAll(async () => {
    await prisma.system.deleteMany({ where: { id: { in: systemIds } } });
    // The Controls first: one has the fixture Framework as its origin, which would block the Framework's removal. No
    // fixture Requirement is in the base Framework, so none is left unmapped meanwhile.
    await prisma.control.deleteMany({ where: { id: { in: controlIds } } });
    await cleanupFixtureRequirements();
    await prisma.requirement.deleteMany({ where: { frameworkId: draftFrameworkId } });
    await prisma.framework.deleteMany({ where: { id: draftFrameworkId } });
    await prisma.deploymentFacet.deleteMany({ where: { id: facetId } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, auditorId] } } });
  });

  it.each(ROLES)("returns the fixture Controls to the %s, with owner, text and the Requirements they satisfy", async (role) => {
    const { view, row } = await find(role, "BASE");
    expect(view).toMatchObject({ userId: `user-${role}`, role, canEdit: CURATORS.includes(role) });
    expect(row).toMatchObject({ ownerId, ownerName: `Test 313 Owner ${suffix}`, examples: ["an example"], intent: "why", applicability: "ORGANIZATIONAL" });
    const mapped = (await find(role, "MAPPED")).row;
    expect(mapped.mappings.filter((m) => !m.draft).map((m) => m.framework.label)).toEqual([`${publishedName}:1`]);
    expect(mapped.mappings[0]).toMatchObject({ coverage: "FULL", requirementTitle: expect.stringContaining("Test fixture Requirement") });
  });

  it("labels a Control without an origin as base, and one with a Published origin as Supplementary of it", async () => {
    const base = await getBaseFramework();
    const { row: baseRow } = await find("VIEWER", "BASE");
    expect(baseRow.source).toEqual({ key: "base", label: `Base · ${frameworkLabel(base)}`, kind: "base", draft: false });
    const { row: sup } = await find("VIEWER", "SUP");
    expect(sup.source).toMatchObject({ label: `Supplementary · ${publishedName}:1`, kind: "supplementary", draft: false });
  });

  it.each(ROLES.filter((role) => !CURATORS.includes(role)))("gives the %s no Draft Framework: not in a mapping, and a Draft origin reads as plain Supplementary", async (role) => {
    const view = await loadControlLibraryView(as(role));
    expect(JSON.stringify(view)).not.toContain(draftName);
    expect(JSON.stringify(view)).not.toContain(draftFrameworkId);
    expect((await find(role, "MAPPED")).row.mappings.map((m) => m.draft)).toEqual([false]);
    expect((await find(role, "DRAFTORIGIN")).row.source).toEqual({ key: "sup", label: "Supplementary", kind: "supplementary", draft: false });
  });

  it.each(CURATORS)("shows the %s the Draft mapping, marked, and the Draft origin", async (role) => {
    expect((await find(role, "MAPPED")).row.mappings.filter((m) => m.draft).map((m) => m.framework.label)).toEqual([`${draftName}:9`]);
    expect((await find(role, "DRAFTORIGIN")).row.source).toMatchObject({ label: `Supplementary · ${draftName}:9`, kind: "supplementary", draft: true });
  });

  it("reads the Organization status: a missing row is Not Started, a Per-System Control has none", async () => {
    expect((await find("VIEWER", "BASE")).row.orgStatus).toBe("FULFILLED");
    expect((await find("VIEWER", "SUP")).row.orgStatus).toBe("NOT_STARTED");
    expect((await find("VIEWER", "BOTH")).row.orgStatus).toBe("NOT_STARTED");
    expect((await find("VIEWER", "PERSYS")).row.orgStatus).toBeNull();
  });

  it("counts the Systems a Per-System or Both Control applies to, and none for an Organizational one", async () => {
    expect((await find("VIEWER", "PERSYS")).row.systemCount).toBe(2);
    expect((await find("VIEWER", "BOTH")).row.systemCount).toBe(2);
    expect((await find("VIEWER", "BASE")).row.systemCount).toBe(0);
  });

  it("lists the Users who may be Control Owner for a curator only, without an Internal Auditor", async () => {
    for (const role of ROLES) {
      const view = await loadControlLibraryView(as(role));
      if (!CURATORS.includes(role)) {
        expect(view.owners).toEqual([]);
        continue;
      }
      expect(view.owners).toContainEqual({ id: ownerId, name: `Test 313 Owner ${suffix}` });
      expect(view.owners.some((owner) => owner.id === auditorId)).toBe(false);
    }
  });

  it("gives the edit actions to the Compliance Manager and Admin only", () => {
    expect(ROLES.filter((role) => canEditControlLibrary({ role })).sort()).toEqual(["ADMIN", "COMPLIANCE_MANAGER"]);
  });
});
