// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ControlAssessmentStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSystemAssessments } from "@/lib/control-assessments";
import { withEffectiveScope, EFFECTIVE_SCOPE_SELECT } from "@/lib/effective-framework-scope";
import { cleanupFixtureRequirements, mapControlsToFramework } from "@/test/framework-fixtures";
import { setupProviderFixtures } from "@/test/provider-fixtures";
import { controlId, oscalUuid } from "@/lib/oscal/ids";
import { buildOscalPackage, loadOscalPackage, NO_DESCRIPTION_TEXT, OSCAL_APP_NS, riskOfAssessment, type OscalSnapshot } from "@/lib/oscal/package-builder";
import { validateOscalPackage } from "@/lib/oscal/validate";

/**
 * Inheritance in the SSP (#443), against real Postgres: the pilot fixture has one Control of each kind, and the SSP's status for
 * every applicable Control is compared with `getSystemAssessments`, the function behind the System page's Controls tab.
 */
type Doc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe("OSCAL Package: inheritance (DB)", () => {
  const fx = setupProviderFixtures("#443 oscal");
  const extra: Record<"shared" | "notApplicable" | "waived" | "notStarted", { id: string; code: string }> = {} as never;
  const ids = { system: "", provider: "", riskId: "" };
  let ssp: Doc;
  let pkg: Awaited<ReturnType<typeof loadOscalPackage>>;
  let pageRows: Awaited<ReturnType<typeof getSystemAssessments>>;

  // The fixtures live only while the package and the page's rows are read (the Systems are Onboarded, so other files'
  // counts of visible Systems would otherwise move while this file runs); the tests then read what was captured.
  async function removeFixtures() {
    await cleanupFixtureRequirements();
    await prisma.risk.deleteMany({ where: { systemId: ids.system } });
    await prisma.system.deleteMany({ where: { id: { in: [ids.system, ids.provider] } } });
    await prisma.control.deleteMany({ where: { id: { in: Object.values(extra).map((c) => c.id) } } });
  }

  const requirementOf = (code: string) => {
    const r = ssp["control-implementation"]["implemented-requirements"].find((x: Doc) => x["control-id"] === controlId(code));
    expect(r, code).toBeDefined();
    return r as Doc;
  };
  const propOf = (holder: Doc, name: string) => holder.props?.find((p: Doc) => p.name === name)?.value as string | undefined;

  beforeAll(async () => {
    for (const key of ["shared", "notApplicable", "waived", "notStarted"] as const) {
      const c = await prisma.control.create({
        data: {
          code: `TEST-443-${key}-${fx.suffix}`,
          title: `Test 443 ${key}`,
          description: "d",
          category: "Test",
          applicability: "PER_SYSTEM",
          mandatory: true,
          question: "Does it?",
          deploymentFacets: { connect: { id: fx.facets.live } },
        },
      });
      extra[key] = { id: c.id, code: c.code };
    }
    await mapControlsToFramework(fx.frameworkId, Object.values(extra).map((c) => c.id));

    ids.provider = await fx.makeSystem({ isProvider: true, name: `Test 443 Provider ${fx.suffix}` });
    ids.system = await fx.makeSystem({ name: `Test 443 System ${fx.suffix}` });
    await fx.depend(ids.system, ids.provider);

    // Locally Fulfilled.
    await fx.assess(ids.system, fx.controls.perSystem.id, "FULFILLED");
    await prisma.controlAssessment.update({
      where: { systemId_controlId: { systemId: ids.system, controlId: fx.controls.perSystem.id } },
      data: { notes: "Done with SSO.", evidence: "https://example.com/e" },
    });
    // Inherited from the Organization (no own Assessment; the Organization has Fulfilled it).
    await prisma.organizationControlImplementation.create({ data: { controlId: fx.controls.both.id, status: "FULFILLED", description: "The Organization enforces it centrally." } });
    // Shared Offering: the Provider has done its half, the customer's is open.
    await fx.offer(ids.provider, extra.shared.id, "SHARED", "Configure the tenant yourself.");
    await fx.assess(ids.provider, extra.shared.id, "FULFILLED");
    await fx.assess(ids.system, extra.shared.id, "IN_PROGRESS");
    // Not Applicable with a rationale.
    await fx.assess(ids.system, extra.notApplicable.id, "NOT_APPLICABLE");
    await prisma.controlAssessment.update({ where: { systemId_controlId: { systemId: ids.system, controlId: extra.notApplicable.id } }, data: { notes: "No such data here." } });
    // Waived, with the Risk its "No" answer opened.
    const waived = await fx.assess(ids.system, extra.waived.id, "WAIVED");
    ids.riskId = (
      await prisma.risk.create({
        data: { systemId: ids.system, title: "Test 443 risk", description: "d", severity: "HIGH", likelihood: "HIGH", controlAssessmentId: waived.id },
      })
    ).id;
    // Not Started: no row at all.

    try {
      pkg = await loadOscalPackage(ids.system, { id: fx.users.owner, role: "SYSTEM_OWNER" });
      if (pkg.kind !== "ok") throw new Error(`package: ${pkg.kind}`);
      ssp = pkg.pkg.ssp["system-security-plan"];
      const row = await prisma.system.findUniqueOrThrow({ where: { id: ids.system }, include: { deploymentFacets: true, ...EFFECTIVE_SCOPE_SELECT } });
      pageRows = await getSystemAssessments(withEffectiveScope(row));
    } finally {
      await removeFixtures();
    }
  });

  afterAll(removeFixtures);

  it("has the same effective status as the System page for every applicable Control", async () => {
    const rows = pageRows;
    expect(rows.length).toBeGreaterThanOrEqual(6);
    const requirements = ssp["control-implementation"]["implemented-requirements"] as Doc[];
    expect(requirements).toHaveLength(rows.length);
    for (const { control, effective } of rows) {
      expect(propOf(requirementOf(control.code), "effective-status"), control.code).toBe(effective.status);
    }
    const status = (code: string) => propOf(requirementOf(code), "effective-status");
    expect(status(fx.controls.perSystem.code)).toBe("FULFILLED");
    expect(status(fx.controls.both.code)).toBe("FULFILLED");
    expect(status(extra.shared.code)).toBe("IN_PROGRESS");
    expect(status(extra.notApplicable.code)).toBe("NOT_APPLICABLE");
    expect(status(extra.waived.code)).toBe("WAIVED");
    expect(status(extra.notStarted.code)).toBe("NOT_STARTED");
  });

  it("has components for this System, the Organization and each Provider, with ids derived from records", () => {
    const components = ssp["system-implementation"].components as Doc[];
    expect(components.map((c) => c.type)).toEqual(["this-system", "policy", "service"]);
    expect(components[0].uuid).toBe(oscalUuid("System", ids.system));
    expect(components[2].uuid).toBe(oscalUuid("System", ids.provider));
    expect(JSON.stringify(ssp)).not.toContain(ids.provider);
  });

  it("credits a locally Fulfilled Control to this System with its notes and evidence", () => {
    const [b, ...rest] = requirementOf(fx.controls.perSystem.code)["by-components"] as Doc[];
    expect(rest).toEqual([]);
    expect(b["component-uuid"]).toBe(oscalUuid("System", ids.system));
    expect(b["implementation-status"].state).toBe("implemented");
    expect(b.description).toBe("Done with SSO.\n\nEvidence: https://example.com/e");
  });

  it("credits an Organization-inherited Control to the Organization with its description", () => {
    const req = requirementOf(fx.controls.both.code);
    expect(propOf(req, "effective-source")).toBe("ORGANIZATION");
    const [b, ...rest] = req["by-components"] as Doc[];
    expect(rest).toEqual([]);
    expect(b["component-uuid"]).toBe(oscalUuid("Organization", "organization"));
    expect(b["implementation-status"].state).toBe("implemented");
    expect(b.description).toBe("The Organization enforces it centrally.");
  });

  it("shows both halves of a Shared Offering, the open customer half as owed", () => {
    const bs = requirementOf(extra.shared.code)["by-components"] as Doc[];
    expect(bs).toHaveLength(2);
    const provider = bs.find((b) => b["component-uuid"] === oscalUuid("System", ids.provider))!;
    const own = bs.find((b) => b["component-uuid"] === oscalUuid("System", ids.system))!;
    expect(provider["implementation-status"].state).toBe("implemented");
    expect(propOf(provider, "offering-type")).toBe("SHARED");
    expect(own["implementation-status"].state).toBe("partial");
    expect(propOf(own, "customer-half")).toBe("open");
    expect(own.description).toBe("Customer responsibility: Configure the tenant yourself.");
  });

  it("keeps a Not Applicable rationale in remarks and points a Waived Control at its Risk", () => {
    const na = requirementOf(extra.notApplicable.code)["by-components"][0] as Doc;
    expect(na["implementation-status"].state).toBe("not-applicable");
    expect(na.remarks).toBe("No such data here.");
    const waived = requirementOf(extra.waived.code)["by-components"][0] as Doc;
    expect(propOf(waived, "risk")).toBe(oscalUuid("Risk", ids.riskId));
    expect(waived.props.find((p: Doc) => p.name === "risk").ns).toBe(OSCAL_APP_NS);
  });

  it("says plainly when nothing is recorded, and invents nothing", () => {
    const b = requirementOf(extra.notStarted.code)["by-components"][0] as Doc;
    expect(b.description).toBe(NO_DESCRIPTION_TEXT);
    expect(b["implementation-status"]).toBeUndefined();
    expect(requirementOf(extra.waived.code)["by-components"][0].description).toBe(NO_DESCRIPTION_TEXT);
  });

  it("reports zero validation errors", () => {
    if (pkg.kind !== "ok") throw new Error("unreachable");
    expect(validateOscalPackage(pkg.pkg)).toEqual([]);
  });
});

describe("buildOscalPackage: inheritance (pure)", () => {
  const base = (over: Partial<OscalSnapshot>): OscalSnapshot => ({
    system: { id: "sys", name: "S", description: null, status: "ONBOARDED", informationTypes: [] },
    controls: [{ id: "c1", code: "A.1", title: "T", description: "D", applicability: "PER_SYSTEM" }],
    applicableControlIds: ["c1"],
    assessments: [],
    organizationImplementations: [],
    providers: [],
    providerSources: [],
    assessmentRisks: [],
    ...over,
  });
  const build = (s: OscalSnapshot) => buildOscalPackage(s, new Date("2026-11-24T10:00:00Z"), () => "00000000-0000-4000-8000-000000000000");
  const requirement = (s: OscalSnapshot) => build(s).ssp["system-security-plan"]["control-implementation"]["implemented-requirements"][0] as Doc;
  const own = (status: ControlAssessmentStatus, personSet = true) => ({ id: "a1", controlId: "c1", status, notes: null, evidence: null, personSet });
  const full = (providerStatus: ControlAssessmentStatus, onboarded = true) => ({
    controlId: "c1",
    source: {
      kind: "PROVIDER" as const,
      type: "FULL" as const,
      status: providerStatus,
      provider: { id: "p1", name: "P" },
      providerOnboarded: onboarded,
      appliesToProvider: true,
      customerResponsibility: null,
    },
  });
  const provider = { id: "p1", name: "P", onboarded: true };

  it("credits a Full Offering to its Provider while the Provider is Onboarded and Fulfilled", () => {
    const r = requirement(base({ providers: [provider], providerSources: [full("FULFILLED")] }));
    expect(r["by-components"]).toHaveLength(1);
    expect(r["by-components"][0]["component-uuid"]).toBe(oscalUuid("System", "p1"));
    expect(r["by-components"][0]["implementation-status"].state).toBe("implemented");
    expect(r.props.find((p: Doc) => p.name === "effective-status").value).toBe("FULFILLED");
  });

  it("keeps a person-set override as the System's own work and marks it", () => {
    const r = requirement(base({ providers: [provider], providerSources: [full("FULFILLED")], assessments: [own("IN_PROGRESS")] }));
    expect(r["by-components"][0]["component-uuid"]).toBe(oscalUuid("System", "sys"));
    expect(r["by-components"][0]["implementation-status"].state).toBe("partial");
    expect(r.props.find((p: Doc) => p.name === "overrides-inherited").value).toBe("true");
  });

  it("leaves out the risk prop when a Waived Control has no linked Risk", () => {
    const r = requirement(base({ assessments: [own("WAIVED")] }));
    expect(r["by-components"][0].props.map((p: Doc) => p.name)).toEqual(["control-assessment-status"]);
  });

  it("picks the oldest linked Risk, then the lowest id", () => {
    const d = (s: string) => new Date(`2026-01-0${s}T00:00:00Z`);
    const risks = [
      { id: "r3", controlAssessmentId: "a1", createdAt: d("2") },
      { id: "r2", controlAssessmentId: "a1", createdAt: d("1") },
      { id: "r1", controlAssessmentId: "a1", createdAt: d("1") },
      { id: "r0", controlAssessmentId: "other", createdAt: d("1") },
    ];
    expect(riskOfAssessment(risks, "a1")).toBe("r1");
    expect(riskOfAssessment(risks, "none")).toBeUndefined();
  });

  it("holds a Fulfilled Control at In Progress while the Provider's half of a Shared Offering is missing", () => {
    const shared = full("NOT_STARTED");
    const r = requirement(
      base({ providers: [provider], providerSources: [{ ...shared, source: { ...shared.source, type: "SHARED" as const } }], assessments: [own("FULFILLED")] }),
    );
    expect(r.props.find((p: Doc) => p.name === "effective-status").value).toBe("IN_PROGRESS");
    const [providerPart, ownPart] = r["by-components"];
    expect(providerPart["implementation-status"]).toBeUndefined();
    expect(ownPart["implementation-status"].state).toBe("implemented");
  });
});
